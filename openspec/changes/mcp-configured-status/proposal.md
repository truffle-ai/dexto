# Proposal

## Why

Library hosts need to distinguish registered configuration from connection progress without exposing credentials or rebuilding MCP connection ownership. Existing manager configuration getters intentionally describe successful connections and restart configuration, leaving disabled and initially failed entries unrepresented.

## What Changes

- Add opt-in configuration registration, configured connection, explicit forgetting and safe configured-server status snapshots.
- Observe overlapping connection attempts without changing existing connection scheduling.
- Preserve legacy restart configuration, connection defaults, error getters and reusable disconnect semantics.

## Capabilities

### New Capabilities

- `mcp-configured-status`: Explicit desired configuration ownership and metadata-only connection status for opted-in manager entries.

### Modified Capabilities

None.

## Impact

Additive public APIs and types in `@dexto/core/mcp`, tests, usage documentation and patch metadata. Existing package consumers require no migration. No host, daemon, authentication policy or new connection engine is introduced.
