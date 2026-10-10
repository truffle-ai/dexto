---
'@dexto/core': patch
'dexto': patch
'@dexto/server': patch
---

Update the MCP SDK v1 dependency to 1.32.1. HTTP/SSE connections now use upstream origin-restricted redirects: configure the final endpoint URL when a service redirects across origins. Preserve direct SDK tool/resource composition and document stdio buffering and OAuth issuer persistence compatibility.
