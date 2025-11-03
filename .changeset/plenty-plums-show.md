---
'@dexto/client-sdk': patch
'@dexto/server': patch
'@dexto/webui': patch
'@dexto/core': patch
'dexto': patch
---

Migrate server API to Hono framework with feature flag

- Migrated Express server to Hono with OpenAPI schema generation
- Added DEXTO_USE_HONO environment variable flag (default: false for backward compatibility)
- Fixed WebSocket test isolation by adding sessionId filtering
- Fixed logger context to pass structured objects instead of stringified JSON
- Fixed CI workflow for OpenAPI docs synchronization
- Updated documentation links and fixed broken API references
