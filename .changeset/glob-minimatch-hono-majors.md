---
'dexto': patch
'@dexto/core': patch
'@dexto/server': patch
'@dexto/image-local': patch
'@dexto/tools-filesystem': patch
---

Move `glob` from 12 to 14, `minimatch` from 10 to 11 and `@hono/node-server` from 1.19.17 to 2.1.5, so Dexto's own dependencies no longer carry their published advisories. The APIs Dexto calls are unchanged, and all three support the Node 20 floor Dexto already requires. The lockfile also moves the MCP SDK's `@hono/node-server` to 2.1.5, which its range already allows, so the Docker image and standalone binaries carry one patched copy. The WebUI is still served the same way.
