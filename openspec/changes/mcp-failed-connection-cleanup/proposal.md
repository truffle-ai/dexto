## Why

Standalone MCP connections can succeed at the transport layer and then fail registration, leaving an unregistered process or session open. The same ownership gap exists when restarting a server.

## What Changes

- Attempt to disconnect failed connection and restart candidates.
- Remove candidate-owned registrations and caches without removing another client.
- Preserve connection error contracts and saved restart configurations.
- Exercise real stdio lifecycle failures and document current standalone APIs and caller-owned authorization.

## Capabilities

### New Capabilities

- `mcp-connection-lifecycle`: Ownership and failure cleanup for standalone MCP connection candidates.

### Modified Capabilities

None.

## Impact

Changes are confined to Core MCP management, regressions, user documentation, and a Core patch changeset. No API signatures, approval defaults, naming rules, cancellation or health APIs, agent engines, or hosted deployment changes are introduced.
