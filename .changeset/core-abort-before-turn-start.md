---
'@dexto/core': patch
---

A run aborted before its turn starts (for example in a `beforeLLMRequest` hook) now ends with `run:complete` (`finishReason: 'cancelled'`) and frees the session, and the `DextoAgent.stream` iterator always ends once the run settles.
