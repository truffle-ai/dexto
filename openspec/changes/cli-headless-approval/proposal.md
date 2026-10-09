## Why

Headless runs execute ordinary tools automatically but have no handler for operations that explicitly disallow automatic approval. Those operations currently reach Core's missing-handler error instead of a clear noninteractive denial.

## What Changes

- Install a CLI-owned immediate denial handler before headless agent startup.
- Preserve normal automatic execution, disabled elicitation, task completion, and JSON/JSONL contracts.
- Verify mandatory approval prevents side effects and remains a recoverable tool error.

Scope: `dexto run` only. Non-goals: new permission flags, task caps, interactive prompts, session/search behavior changes, shared Core changes, Cloud upgrades.

## Capabilities

### New Capabilities

- `headless-approval`: Deliberate handling of approval requests that cannot be answered interactively.

### Modified Capabilities

None.

## Impact

CLI bootstrap and approval handler/tests, plus a CLI patch changeset. Existing Core approval response types are reused. Cloud hosts its own approval handler and does not consume CLI composition; Core/server/image packages and Cloud pins remain unchanged.
