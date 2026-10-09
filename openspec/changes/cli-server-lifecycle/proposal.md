## Why

The local CLI can announce a running server before its socket binds, and its shutdown path stops the agent without closing the HTTP server. Reliable startup and cleanup are needed for local and sandbox usage.

## What Changes

- Await the listening socket before reporting readiness; surface bind failures through normal CLI startup errors.
- Give the CLI HTTP host an idempotent stop operation that closes owned HTTP/MCP resources, stops the current agent, and removes its shutdown listeners.
- Attempt cleanup of initialized host resources when startup fails, preserving the original startup error.
- Add real process coverage for health readiness, occupied ports, and SIGTERM shutdown.

Scope is local CLI server/WebUI hosting. Non-goals: Core behavior changes, shared server-package consolidation, new deployables, agent task bounds, approval defaults, Cloud package upgrades, or packaging redesign.

## Capabilities

### New Capabilities

- `cli-server-lifecycle`: Socket readiness, startup rollback, and owned shutdown for the local CLI HTTP host.

### Modified Capabilities

None.

## Impact

Changes stay in `packages/cli` plus user documentation, planning artifacts, and a CLI changeset. Existing HTTP routes and default modes remain compatible. Cloud constructs Core directly and does not consume CLI host composition; verify the diff stays outside shared Core/server/image packages. No Cloud deployment or dependency-pin changes are needed for this boundary.
