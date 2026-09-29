---
'@dexto/llm': patch
---

Expose `max` reasoning effort for Anthropic models (e.g. Claude Fable 5) when routed through OpenRouter / dexto-nova gateways. Previously the gateway profile stripped `max`; OpenRouter now supports it, so capable models keep their native variants and default.
