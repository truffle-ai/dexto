---
'@dexto/core': patch
---

Preserve mixed text and media tool results as structured content parts instead of stringifying media objects into prompt text, and keep tool-result media payloads base64-only for Vercel AI SDK compatibility.
