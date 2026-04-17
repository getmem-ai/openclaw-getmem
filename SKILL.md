---
name: getmem
description: 'Add persistent memory to your AI agent using getmem.ai. This skill teaches you how to use the getmem-ai SDK to remember users across sessions.'
metadata:
  {
    "openclaw": {
      "emoji": "🧠",
      "install": [
        {
          "id": "pip-getmem",
          "kind": "pip",
          "package": "getmem-ai",
          "label": "Install getmem-ai SDK"
        }
      ]
    }
  }
---

# getmem.ai Memory Skill

Add persistent memory to your AI agent. Users are remembered across sessions automatically.

## What this skill does

- Retrieves relevant memories before each LLM call
- Saves conversations after each turn
- Stores both user and assistant messages
- Memory persists indefinitely — no expiry

## Install the SDK

```bash
pip install getmem-ai
```

## Get an API key

Sign up at https://platform.getmem.ai and create an API key.

## How to use

Initialize the client with your API key:

```python
import getmem_ai as getmem

mem = getmem.init("your-api-key-here")
```

Before each LLM call, retrieve relevant memory context:

```python
result = mem.get(user_id, query=user_message)
context = result["context"]
# Add context to your system prompt
```

After each turn, save the conversation:

```python
mem.ingest(user_id, messages=[
    {"role": "user", "content": user_message},
    {"role": "assistant", "content": reply},
])
```

## Token savings

Saves up to 95% on context tokens by injecting only relevant memories instead of full history.

## Links

- Website: https://getmem.ai
- Documentation: https://getmem.ai/llms-full.txt
- PyPI: https://pypi.org/project/getmem-ai/
- npm: https://npmjs.com/package/getmem
