---
'@dexto/agent-management': patch
'@dexto/server': patch
'@dexto/webui': patch
'@dexto/core': patch
'dexto': patch
---

## Logger v2 & Config Enrichment

### New Features

- **Multi-transport logging system**: Configure console, file, and remote logging transports via `logger` field in agent.yml. Supports log levels (error, warn, info, debug, silly) and automatic log rotation for file transports.
- **Per-agent isolation**: CLI automatically creates per-agent log files at `~/.dexto/logs/<agent-id>.log`, database at `~/.dexto/database/<agent-id>.db`, and blob storage at `~/.dexto/blobs/<agent-id>/`
- **Agent ID derivation**: Agent ID is now automatically derived from `agentCard.name` (sanitized) or config filename, enabling proper multi-agent isolation without manual configuration

### Breaking Changes

- **Storage blob default changed**: Default blob storage type changed from `local` to `in-memory`. Existing configs with explicit `blob: { type: 'local' }` are unaffected. CLI enrichment provides automatic paths for SQLite and local blob storage.

### Improvements

- **Config enrichment layer**: New `enrichAgentConfig()` in agent-management package adds per-agent paths before initialization, eliminating path resolution in core services
- **Logger error factory**: Added typed error factory pattern for logger errors following project conventions
- **Removed wildcard exports**: Logger module now uses explicit named exports for better tree-shaking

### Documentation

- Added complete logger configuration section to agent.yml documentation
- Documented agentId field and derivation rules
- Updated storage documentation with CLI auto-configuration notes
- Added logger v2 architecture notes to core README
