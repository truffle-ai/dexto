---
'@dexto/core': patch
---

A 401 that the host's request auth classifies as retryable (for example an expired gateway credential the host renews) is retried again instead of failing the turn with `llm_auth_failed`. Every other 401 stays final.
