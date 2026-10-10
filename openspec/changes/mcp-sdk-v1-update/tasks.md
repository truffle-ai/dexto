# Tasks

## 1. SDK v1 transport compatibility

- [x] 1.1 Verify official v1 release/source changes and observe cross-origin redirect regression failing on SDK 1.28.0.
- [x] 1.2 Align workspace dependency ranges and lockfile on SDK 1.32.1; verify real HTTP direct and same-origin tool/resource/header operations and cross-origin denial pass.
- [x] 1.3 Document redirect migration, stdio buffering and OAuth issuer persistence in the guide/reference and changeset; verify strict OpenSpec and formatting checks.
- [x] 1.4 Verify OAuth issuer records round-trip through the existing CLI store and real stdio/HTTP/SSE regressions pass.

## 2. Integrated validation

- [x] 2.1 Ordinary-merge current main including standalone CLI publication; verify the final diff remains SDK scoped.
- [x] 2.2 Run full OSS quality checks and existing consumer-composition checks against the built candidate.
- [x] 2.3 Run native MCP/direct client acceptance against the updated built CLI and verify exact stdio/HTTP results with cleanup.

## Workflow follow-up

- Verify submitted exact-head CI and reviews before merging the independent pull request.
