/**
 * getmem.ai OpenClaw Plugin
 *
 * Adds persistent memory to every OpenClaw agent session.
 * Memory is stored per-user and automatically injected as context
 * before each LLM call via the message:received hook.
 *
 * Install:
 *   openclaw plugins install clawhub:@getmem/openclaw-getmem
 *   openclaw config set plugins.openclaw-getmem.apiKey gm_live_...
 *   openclaw gateway restart
 */

import { definePluginEntry, buildPluginConfigSchema } from "openclaw/plugin-sdk/plugin-entry";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { InternalHookEvent } from "openclaw/plugin-sdk/hook-runtime";
import { z } from "openclaw/plugin-sdk/zod";

// ── Config schema (Zod) ───────────────────────────────────────────────────────

const ConfigSchema = z.object({
  apiKey: z.string().min(1, "getmem API key is required"),
  baseUrl: z.string().url().optional().default("https://memory.getmem.ai"),
  enabled: z.boolean().optional().default(true),
});

type GetMemConfig = z.infer<typeof ConfigSchema>;

// ── Minimal fetch-based client ────────────────────────────────────────────────

interface MemGetResult {
  context: string;
  memories: Array<{ id: string; text: string; relevance_score: number }>;
}

class GetMemClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl = "https://memory.getmem.ai") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      throw new Error(`getmem ${res.status}: ${String(err["error"] ?? res.statusText)}`);
    }
    return res.json() as Promise<T>;
  }

  async get(userId: string, query: string): Promise<MemGetResult> {
    return this.post<MemGetResult>("/v1/memory/get", { user_id: userId, query });
  }

  async ingest(userId: string, userMessage: string, assistantMessage: string): Promise<void> {
    const now = new Date().toISOString();
    await this.post("/v1/memory/ingest", {
      user_id: userId,
      messages: [
        { role: "user", content: userMessage, timestamp: now },
        { role: "assistant", content: assistantMessage, timestamp: now },
      ],
    });
  }
}

// ── Typed hook contexts ───────────────────────────────────────────────────────

interface MessageReceivedContext {
  from: string;
  content: string;
  channelId: string;
  metadata?: Record<string, unknown>;
}

interface MessageSentContext {
  to: string;
  content: string;
  success: boolean;
  channelId: string;
}

// ── Per-session state ─────────────────────────────────────────────────────────

const pending = new Map<string, { userId: string; userMessage: string }>();

// ── Plugin ────────────────────────────────────────────────────────────────────

export default definePluginEntry({
  id: "openclaw-getmem",
  name: "getmem.ai Memory",
  description:
    "Persistent memory for every user via getmem.ai. Remembers users across sessions automatically.",

  configSchema: buildPluginConfigSchema(ConfigSchema),

  register(api: OpenClawPluginApi) {
    const raw = (api.pluginConfig ?? {}) as unknown;
    const parsed = ConfigSchema.safeParse(raw);

    if (!parsed.success) {
      api.logger.warn(
        "[getmem] Invalid config — set plugins.openclaw-getmem.apiKey to your getmem API key"
      );
      return;
    }

    const cfg: GetMemConfig = parsed.data;

    if (!cfg.enabled) {
      api.logger.info("[getmem] Memory disabled via config");
      return;
    }

    const mem = new GetMemClient(cfg.apiKey, cfg.baseUrl);

    // ── Hook 1: message:received
    // Fires when an inbound message arrives from any channel.
    // Fetch memory for the sender and push as context for the agent.
    api.registerHook("message:received", async (event: InternalHookEvent) => {
      const ctx = event.context as unknown as MessageReceivedContext;
      const userId =
        typeof ctx.metadata?.["senderId"] === "string"
          ? ctx.metadata["senderId"]
          : ctx.from;
      const userMessage = ctx.content;

      // Store for post-reply ingest
      pending.set(event.sessionKey, { userId, userMessage });

      try {
        const result = await mem.get(userId, userMessage);
        if (result.context?.trim()) {
          event.messages.push(`[Memory]\n${result.context}`);
        }
      } catch (err) {
        api.logger.warn(
          `[getmem] Memory fetch failed for ${userId}: ${(err as Error).message}`
        );
      }
    });

    // ── Hook 2: message:sent
    // Fires after the agent's reply is delivered.
    // Ingest the exchange — fire-and-forget, never blocks the reply pipeline.
    api.registerHook("message:sent", async (event: InternalHookEvent) => {
      const ctx = event.context as unknown as MessageSentContext;
      if (!ctx.success) return;

      const state = pending.get(event.sessionKey);
      if (!state) return;
      pending.delete(event.sessionKey);

      void mem.ingest(state.userId, state.userMessage, ctx.content).catch(
        (err: Error) => {
          api.logger.warn(
            `[getmem] Ingest failed for ${state.userId}: ${err.message}`
          );
        }
      );
    });

    api.logger.info("[getmem] Memory active — getmem.ai");
  },
});
