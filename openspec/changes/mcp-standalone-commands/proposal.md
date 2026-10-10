## Why

Direct MCP setup, discovery and calls currently require an agent configuration and aggregation mode. Operators and agents need deterministic standalone commands without a model or login.

## What Changes

- Add MCP-only configuration commands and one-shot connection/discovery/call commands.
- Preserve literal environment templates and avoid exposing configured credentials.
- Close owned connections after every operation and return machine-readable results and distinct exit outcomes.
- Preserve the existing aggregation command.

## Capabilities

### New Capabilities

- `standalone-mcp-cli`: Configure and use MCP servers without bootstrapping an agent.

### Modified Capabilities

None.

## Impact

CLI commands, regression tests, documentation and patch release metadata. Existing MCP library APIs are reused; no new runtime or dependencies.
