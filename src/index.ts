/**
 * getmem.ai OpenClaw Plugin
 *
 * Adds persistent memory to every OpenClaw agent session.
 * Memory is stored per-user and injected automatically into
 * the system prompt before each LLM call.
 *
 * Install:
 *   openclaw plugins install clawhub:@getmem/openclaw-getmem
 *   openclaw config set plugins.openclaw-getmem.apiKey gm_live_...
 *   openclaw gateway restart
 *
 * That's it. No code changes required.
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

// ── Types ─────────────────────────────────────────────────────────────────────

interface GetMemPluginConfig {
  apiKey: string;
  baseUrl?: string;
  enabled?: boolean;
}

// Minimal inline client — avoids build-time issues with getmem-ai ESM
// while keeping the plugin self-contained. Uses the same API surface.

interface MemoryResult {
  context: string;
  memories: Array<{ id: string; text: string; relevance_score: number }>;
  meta: { total_ms: number; token_count: number };
}

interface IngestResult {
  status: string;
  messages_accepted: number;
}

// ── Memory client ─────────────────────────────────────────────────────────────

class GetMemClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl = "https://memory.getmem.ai") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as Record<string, unknown>;
      throw new Error(
        `getmem API error ${res.status}: ${err["error"] ?? res.statusText}`
      );
    }
    return res.json() as Promise<T>;
  }

  async get(userId: string, query: string): Promise<MemoryResult> {
    return this.request<MemoryResult>("POST", "/v1/memory/get", {
      user_id: userId,
      query,
    });
  }

  async ingest(
    userId: string,
    userMessage: string,
    assistantMessage: string
  ): Promise<IngestResult> {
    const now = new Date().toISOString();
    return this.request<IngestResult>("POST", "/v1/memory/ingest", {
      user_id: userId,
      messages: [
        { role: "user", content: userMessage, timestamp: now },
        { role: "assistant", content: assistantMessage, timestamp: now },
      ],
    });
  }

  async health(): Promise<{ status: string }> {
    return this.request<{ status: string }>("GET", "/v1/health");
  }
}

// ── Plugin ────────────────────────────────────────────────────────────────────

// Per-session state: track last user message so we can ingest after the reply
const pendingIngests = new Map<
  string,
  { userId: string; userMessage: string }
>();

export default definePluginEntry({
  id: "openclaw-getmem",
  name: "getmem.ai Memory",
  description:
    "Persistent memory for every user via getmem.ai. Remembers users across sessions automatically.",

  register(api) {
    const config = api.getConfig<GetMemPluginConfig>();

    if (config.enabled === false) {
      console.log("[getmem] Memory disabled via config");
      return;
    }

    if (!config.apiKey) {
      console.warn(
        "[getmem] No API key configured. Set plugins.openclaw-getmem.apiKey"
      );
      return;
    }

    const mem = new GetMemClient(config.apiKey, config.baseUrl);

    // ── Hook 1: message:preprocessed
    // Fires after all media/link processing, before the agent sees the message.
    // We use this to:
    //   (a) extract the sender ID as user_id
    //   (b) fetch memory context and append to bodyForAgent
    api.registerHook(
      "message:preprocessed",
      async (event: {
        type: string;
        sessionKey: string;
        context: {
          bodyForAgent: string;
          from: string;
          channelId: string;
          metadata?: { senderId?: string; senderName?: string };
        };
        messages: string[];
      }) => {
        const userId =
          event.context.metadata?.senderId ?? event.context.from ?? "default";
        const userMessage = event.context.bodyForAgent;

        // Store for post-reply ingest
        pendingIngests.set(event.sessionKey, { userId, userMessage });

        // Fetch relevant memory
        try {
          const result = await mem.get(userId, userMessage);
          if (result.context && result.context.trim()) {
            // Append memory context to the body the agent receives
            event.context.bodyForAgent =
              `${userMessage}\n\n` +
              `[Memory context for ${userId}]\n${result.context}`;
          }
        } catch (err) {
          // Never block the agent — memory is best-effort
          console.warn(
            `[getmem] Failed to fetch memory for ${userId}:`,
            (err as Error).message
          );
        }
      }
    );

    // ── Hook 2: message:sent
    // Fires after the agent's reply is delivered.
    // We ingest the user + assistant exchange into memory.
    api.registerHook(
      "message:sent",
      async (event: {
        type: string;
        sessionKey: string;
        context: {
          to: string;
          content: string;
          success: boolean;
          channelId: string;
        };
        messages: string[];
      }) => {
        if (!event.context.success) return;

        const pending = pendingIngests.get(event.sessionKey);
        if (!pending) return;

        pendingIngests.delete(event.sessionKey);

        const { userId, userMessage } = pending;
        const reply = event.context.content;

        // Fire-and-forget — never block the reply pipeline
        void mem.ingest(userId, userMessage, reply).catch((err: Error) => {
          console.warn(
            `[getmem] Failed to ingest for ${userId}:`,
            err.message
          );
        });
      }
    );

    console.log("[getmem] Memory plugin active — getmem.ai");
  },
});
