---
'dexto': patch
---

Keep saved MCP OAuth credentials tied to the server URL they were issued for, so a config that reuses a server name for a different URL no longer receives them. Existing saved entries move to the first server URL that uses them. The browser is opened only for http(s) authorization URLs, the sign-in callback listens on 127.0.0.1 only, and the credential file and folder are readable only by their owner.
