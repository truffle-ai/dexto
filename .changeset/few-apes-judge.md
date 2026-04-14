---
'dexto': patch
'@dexto/analytics': patch
'@dexto/core': patch
'@dexto/server': patch
'@dexto/tui': patch
'@dexto/webui': patch
---

Publish LLM usage analytics cost metrics.

- `dexto` / `@dexto/tui`: include estimated USD cost and per-bucket cost fields in CLI LLM usage analytics.
- `@dexto/webui`: include estimated USD cost and per-bucket cost fields in WebUI LLM usage analytics.
- `@dexto/analytics`: extend the shared `dexto_llm_tokens_consumed` event payload with cost fields.
- `@dexto/core`: emit `costBreakdown` alongside `estimatedCost` from shared LLM pricing metadata.
- `@dexto/server`: forward the emitted cost breakdown through usage delivery and A2A SSE events.
