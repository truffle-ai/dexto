## 1. Startup ownership

- [x] 1.1 Reproduce ignored strict startup through local protocol fixtures, then implement strict overrides and rollback.
- [x] 1.2 Cover partial startup and idempotent explicit/transport shutdown.

## 2. Protocol snapshot

- [x] 2.1 Reproduce raw schema, metadata and tool error result loss, then bind SDK forwarding to startup identities.
- [x] 2.2 Cover resource metadata, prompt arguments and duplicate/ambiguous identities.
- [x] 2.3 Cover forwarded cancellation and fixed snapshot behavior.

## 3. Release validation

- [x] 3.1 Add release metadata and user-facing snapshot/authorization behavior.
- [x] 3.2 Run focused protocol tests, scoped lint/format/types and independent simplification review.
- [x] 3.3 Consume the upstream Core connection cleanup fix and complete the coordinated full validation gate.
