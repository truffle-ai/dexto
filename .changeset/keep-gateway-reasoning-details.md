---
'@dexto/core': patch
---

Keep the Dexto gateway's reasoning items through a tool loop. On `dexto-nova`, a tool call now keeps its `openrouter.reasoning_details` in history and sends them back on the next request, so GPT models keep their encrypted reasoning and Claude keeps its signed thinking between tool calls. The OpenRouter client's `[REDACTED]` placeholder for an encrypted reasoning item is no longer shown as reasoning text.
