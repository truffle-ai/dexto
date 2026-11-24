---
'dexto': patch
---

`--api-base-url` and `DEXTO_API_BASE_URL` now reach every command. Workspace commands (`apps`, `chat list`, `projects`, `skills` and the rest) used to call the signed-in Dexto's MCP whatever origin was given; with another origin they now call `<origin>/mcp`. A value that isn't an http or https URL exits 2 with `--api-base-url must be an http or https URL.`
