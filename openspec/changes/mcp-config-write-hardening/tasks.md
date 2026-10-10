## 1. Implementation and regressions

- [x] 1.1 Observe permissive existing-file mode regression before implementing private atomic replacement.
- [x] 1.2 Observe leaf-symlink edit acceptance before adding refusal checks.
- [x] 1.3 Preserve add/remove comments, literal templates, missing-file creation and existing command outcomes.
- [x] 1.4 Cover partial-write/rename failure preservation and owned temporary cleanup through real files.
- [x] 1.5 Verify actual CLI add/remove permissions and symlink outcomes.

## 2. Validation and handoff

- [x] 2.1 Run changed CLI typecheck, focused tests, lint, format and strict specification validation.
- [x] 2.2 Run the canonical repository quality gate on the final source tree.
- [x] 2.3 Independently review the source and documented compatibility limits.

Workflow follow-up: confirm exact submitted-head CI and review readiness before merge.
