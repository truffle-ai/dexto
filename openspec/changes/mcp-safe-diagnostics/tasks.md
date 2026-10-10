## 1. Diagnostics boundary

- [x] 1.1 Observe payload, raw-error and transport logging regressions with sentinel data before each fix.
- [x] 1.2 Remove raw fields from MCP client and manager logging; preserve operation metadata and fixed failure classifications.
- [x] 1.3 Cover real stdio notifications and HTTP/SSE failures alongside unchanged inspection, event and approval contracts.
- [x] 1.4 Simplify unused catch bindings without introducing a redactor or logging abstraction.

## 2. Documentation and validation

- [x] 2.1 Document operational logging and raw inspection APIs; add a Core patch changeset.
- [x] 2.2 Complete focused tests, lint, formatting and strict specification validation.
- [x] 2.3 Complete coordinated Core build/typecheck, consumer compatibility review and full quality gate before publication.
