---
'@dexto/server': patch
---

Apply configured server authentication consistently to HTTP MCP requests, preserve explicit external authentication ownership, and omit raw protocol payloads from diagnostics. Clients must use the documented Authorization: Bearer header scheme.
