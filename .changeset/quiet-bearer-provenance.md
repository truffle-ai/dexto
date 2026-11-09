---
'@dexto/core': patch
---

Allow hosts to classify failed model requests using per-request credential provenance.

Runtime base URLs and headers are now honored by Google, Groq, xAI, Cohere, OpenRouter, and Vertex. Vertex still requires Application Default Credentials and sends its ADC bearer to a runtime URL unless the host supplies an Authorization header; Vertex cannot use request authentication without ADC. Bedrock, local models, and the Codex app server reject gateway overrides they cannot use. Blank runtime URLs are rejected.
