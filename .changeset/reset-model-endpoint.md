---
'@dexto/core': patch
'@dexto/tui': patch
'dexto': patch
---

Choosing a model with no endpoint now uses its provider's default endpoint instead of keeping the previous model's custom `baseURL`. LLM switch updates accept `baseURL: null` to ask for the default endpoint; leaving `baseURL` out still keeps the current one. The TUI model picker and `dexto acp` model selection use it.
