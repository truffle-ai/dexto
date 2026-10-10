## Why

Same-name client replacement intentionally keeps captured in-flight calls usable, but the manager loses the replaced client reference. Overlapping connections can therefore leave a real stdio child running after manager shutdown.

## What Changes

- Retain displaced different client identities until `disconnectAll()`.
- Disconnect current and retained identities once each during existing reusable cleanup.
- Preserve same-name overwrite, captured-call routing, cache ordering and existing failure logging.
- Prove cleanup with real child processes and identity/failure unit regressions.

## Capabilities

### New Capabilities

- `mcp-client-ownership`: ownership of displaced identities through manager-wide cleanup.

### Modified Capabilities

None.

## Impact

Only Core MCP manager ownership, tests, documentation and a patch changeset. No process signal policy, connection cancellation, configuration cache consistency redesign or hosted integration changes.
