---
'@dexto/core': minor
'dexto': patch
'@dexto/agent-management': patch
'@dexto/server': patch
---

PostgreSQL improvements and privacy mode

**PostgreSQL enhancements:**
- Add connection resilience for serverless databases (Neon, Supabase, etc.) with automatic retry on connection failures
- Support custom PostgreSQL schemas via `options.schema` config
- Add schema name validation to prevent SQL injection
- Improve connection pool error handling to prevent process crashes

**Privacy mode:**
- Add `--privacy-mode` CLI flag to hide file paths from output (useful for screen recording/sharing)
- Can also be enabled via `DEXTO_PRIVACY_MODE=true` environment variable

**Session improvements:**
- Add message deduplication in history provider to handle data corruption gracefully
- Add warning when conversation history hits 10k message limit
- Improve session deletion to ensure messages are always cleaned up

**Other fixes:**
- Sanitize explicit `agentId` for filesystem safety
- Change verbose flush logs to debug level
- Export `BaseTypedEventEmitter` from events module
