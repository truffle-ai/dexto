---
'@dexto/server': patch
---

Mask environment and header values in the MCP server config route, using the same masking as the config export route. Header values on HTTP and SSE servers are now masked in the export as well.
