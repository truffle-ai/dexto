# Tasks

## 1. Orderly manager teardown

- [x] 1.1 Reproduce premature cleanup with a gated real stdio handshake regression, then track complete startup/restart operations and make that test pass.
- [x] 1.2 Verify real stdio restart, registered discovery, original failure outcome, child-process cleanup, desired registration and reconnect behavior with focused lifecycle tests.
- [x] 1.3 Document caller quiescence, draining timing, reusable ownership and unchanged direct-client behavior; verify formatting and strict OpenSpec validation.

## 2. Integration validation

- [x] 2.1 Run changed Core types and the canonical full OSS quality gate on the final integrated source tree.
- [x] 2.2 Complete independent source/test review and existing consumer-composition tests using the built candidate MCP entrypoint.

## Workflow follow-up

- Archive after repository review and merge requirements are satisfied.
