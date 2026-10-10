## 1. MCP current context

- [x] 1.1 Reproduce stale chat routing with a real MCP client/server protocol regression, then add current-agent resolution.
- [x] 1.2 Reproduce stale card discovery, then resolve the card per read without changing static registration.
- [x] 1.3 Cover static compatibility, fixed connection identity, availability errors and per-call session cleanup ownership.

## 2. CLI host integration

- [x] 2.1 Reproduce missing host getter wiring, then connect MCP to the existing active-agent/card availability boundary.
- [x] 2.2 Verify successful and failed switches, in-flight switch errors and shutdown.
- [x] 2.3 Add patch release metadata and MCP guide behavior.

## 3. Validation

- [x] 3.1 Run focused protocol and host tests, package builds/types and changed-source formatting/lint checks.
- [x] 3.2 Complete independent simplification review and full upstream validation before publishing.
