---
"@dexto/core": patch
---

Keep a tool schema's root `definitions` and `$defs` when flattening a union root, so a `$ref` inside an alternative still resolves. xAI rejects a tool whose `$ref` points nowhere.
