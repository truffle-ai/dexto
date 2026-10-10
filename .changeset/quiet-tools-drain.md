---
'@dexto/core': patch
---

Drain already-started MCP connection and restart operations through discovery before disconnecting clients and clearing caches. Stop starting new operations before teardown; existing outcomes and desired registrations are preserved without adding cancellation or timeouts.
