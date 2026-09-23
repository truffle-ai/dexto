---
'@dexto/llm': patch
'@dexto/core': patch
---

Let hosts supply an authoritative reasoning profile through `createModelRegistry(providers, { getReasoningProfile })`, so core accepts and sends reasoning variants the host allows (including on OpenRouter/Dexto Nova). Turning reasoning off on OpenRouter/Dexto Nova (`disabled` or `none`) now sends `reasoning: { enabled: false }` instead of only hiding reasoning output.
