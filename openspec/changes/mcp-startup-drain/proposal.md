# Proposal

## Why

`disconnectAll()` can finish while an already-started connection or restart is still completing its handshake or discovery. That operation can subsequently register a live client or repopulate caches after teardown.

## What Changes

- Drain connection and restart operations already pending when teardown begins, including discovery, before disconnecting clients and clearing caches.
- Preserve the operations' existing success and failure outcomes, reusable manager behavior, and desired server registrations.
- Document caller responsibility to stop starting new operations before teardown, and that draining waits for existing protocol and authentication completion.

## Capabilities

### New Capabilities

- `mcp-connection-lifecycle`: Orderly teardown of already-started manager connection operations.

### Modified Capabilities

None; this repository has no durable lifecycle spec yet.

## Impact

Only the portable `@dexto/core/mcp` manager and its tests/documentation change. Public signatures, direct client behavior, permission defaults, naming, and dependency versions remain unchanged. Existing consumers receive stronger orderly cleanup; consumer-composition checks validate compatibility. Cancellation, new deadlines, operations started during teardown, independent refresh/notification races, and hosted policy changes are out of scope.
