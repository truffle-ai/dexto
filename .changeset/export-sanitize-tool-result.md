---
'@dexto/core': patch
---

`sanitizeToolResult` is exported from `@dexto/core/context`, so a host that runs a tool for another model, such as Dexto Cloud's tool relay to Claude Code, can give that model the same content a Dexto turn's model gets, its images as image parts.
