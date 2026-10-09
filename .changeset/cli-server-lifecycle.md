---
'dexto': patch
---

Wait for the local CLI HTTP server to bind before announcing readiness, report port conflicts through normal startup errors, and clean up initialized resources after failures. Add idempotent shutdown that closes HTTP/MCP resources, stops the current agent, and removes owned process listeners.
