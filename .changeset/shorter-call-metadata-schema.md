---
'@dexto/core': patch
---

Every tool's `__meta` schema drops `additionalProperties: true`, JSON Schema's default: other metadata keys stay allowed, and a Slack Project turn with 51 tools sends about 300 fewer input tokens per model call.
