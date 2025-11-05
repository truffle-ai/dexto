---
'@dexto/webui': patch
'@dexto/core': patch
'dexto': patch
---

Decoupled elicitation from tool confirmation. Added `DenialReason` enum and structured error messages to approval responses.

- Tool approvals and elicitation now independently configurable via `elicitation.enabled` config
- Approval errors include `reason` (user_denied, timeout, system_denied, etc.) and `message` fields
- Enables `auto-approve` for tools while preserving interactive elicitation

Config files without the new `elicitation` section will use defaults. No legacy code paths.
