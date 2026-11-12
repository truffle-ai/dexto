---
'@dexto/core': patch
---

A 401 from a model provider is final: it is never retried, even if the provider marks it retryable, and it surfaces as `llm_auth_failed`. For the Dexto gateway the message says to sign in again with `dexto login` or create a new API key.
