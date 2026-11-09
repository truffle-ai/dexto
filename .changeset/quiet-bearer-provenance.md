---
'@dexto/core': patch
---

Allow hosts to classify failed model requests using per-request credential provenance.

Bedrock's AWS SDK transport and the Codex app-server do not use the runtime fetch hook.
