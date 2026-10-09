## 1. CLI host lifecycle

- [x] 1.1 Add a failing readiness/bind-error regression and await actual listening.
- [x] 1.2 Add shutdown/disposal regressions and idempotent cleanup of current agent, HTTP/MCP resources, and process hooks.
- [x] 1.3 Verify rollback after startup failures and cleanup failure isolation.

## 2. Process validation and release

- [x] 2.1 Exercise real CLI processes for health readiness, occupied port errors, and SIGTERM port release.
- [x] 2.2 Confirm the diff remains CLI-only and record the Cloud compatibility evidence.
- [x] 2.3 Simplify the implementation and run focused tests, strict OpenSpec, and the full upstream quality gate.
- [x] 2.4 Update user docs and CLI patch changeset.
- [ ] 2.5 Submit upstream PR and handle CI/review.
