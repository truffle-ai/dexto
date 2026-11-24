---
'dexto': minor
'@dexto/agent-management': patch
---

Add `dexto capabilities search <query> [--limit N] [--offset N]` to page through the account capability catalog (Dexto platform tools, connected MCP servers and managed connections) over `dexto_capabilities_search`. It needs `capabilities:read`, which joins the CLI's sign-in scopes, and never calls a capability.
