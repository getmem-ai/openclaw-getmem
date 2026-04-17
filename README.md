# @getmem/openclaw-getmem

Persistent memory for OpenClaw agents via [getmem.ai](https://getmem.ai).

Every user is remembered across sessions, conversations, and gateway restarts — automatically.

## Install

```bash
# 1. Install the plugin
openclaw plugins install clawhub:@getmem/openclaw-getmem

# 2. Set your API key
openclaw config set plugins.openclaw-getmem.apiKey gm_live_...

# 3. Restart the gateway
openclaw gateway restart
```

Get your API key at [platform.getmem.ai](https://platform.getmem.ai)

## How it works

The plugin hooks into two points in the OpenClaw message pipeline:

1. **Before each LLM call** — fetches relevant memory for the user and appends it to the message context automatically
2. **After each reply** — saves the conversation exchange to memory in the background (non-blocking)

No code changes required. Works with all channels (Telegram, Discord, Signal, WhatsApp, etc.)

## Configuration

| Key | Required | Default | Description |
|-----|----------|---------|-------------|
| `apiKey` | ✅ | — | Your getmem.ai API key (`gm_live_...`) |
| `baseUrl` | — | `https://memory.getmem.ai` | Custom API endpoint |
| `enabled` | — | `true` | Disable memory without uninstalling |

Set config values:
```bash
openclaw config set plugins.openclaw-getmem.apiKey gm_live_...
openclaw config set plugins.openclaw-getmem.enabled false  # to disable
```

## What gets remembered

- User preferences and choices
- Facts about the user's context
- Past decisions and goals
- Relationships and constraints
- Anything mentioned across previous conversations

Memory is scoped per user (by sender ID) and retrieved using semantic search — only relevant context is injected, not everything at once.

## Token efficiency

Standard approach: entire conversation history sent every turn (10,000–40,000+ tokens).

With getmem: only relevant memory injected (200–800 tokens). **Save up to 95% on context tokens.**

## Links

- Website: [getmem.ai](https://getmem.ai)
- Platform (API keys): [platform.getmem.ai](https://platform.getmem.ai)
- Python SDK: [pypi.org/project/getmem-ai](https://pypi.org/project/getmem-ai/)
- JavaScript SDK: [npmjs.com/package/getmem](https://npmjs.com/package/getmem)

## License

MIT
