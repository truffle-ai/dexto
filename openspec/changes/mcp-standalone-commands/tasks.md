## 1. Configuration

- [x] 1.1 Add safe listing and literal-preserving add/remove; verify configuration regressions and document the file contract.
- [x] 1.2 Register nested commands and preserve legacy aggregation; verify real CLI process setup without model credentials.

## 2. One-shot operations

- [x] 2.1 Add explicit server connection/discovery/call using the existing manager; verify real stdio results and safe errors.
- [x] 2.2 Verify success, handshake failure and tool failure cleanup through CLI process regressions; document closed ownership and caller authorization.

- [x] 2.3 Verify MCP-only gateway discovery/call and owned EOF/signal shutdown after integration with the aggregation lifecycle slice.

## 3. Integration

- [x] 3.1 Validate focused tests, CLI build/types/lint, strict specification and release metadata.
- [x] 3.2 Complete independent review and coordinated full quality gate before publication.
