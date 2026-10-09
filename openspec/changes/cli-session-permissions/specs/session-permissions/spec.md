## ADDED Requirements

### Requirement: Explicit session approval scope

The TUI SHALL offer allow-once, allow-scope-for-this-session and reject choices where supported, displaying the remembered scope. Remembered grants SHALL remain confined to the logical session and SHALL survive resume through existing stores. A session choice SHALL NOT create global permissions.

#### Scenario: Remember an action

- **WHEN** a user remembers a tool-authored action scope
- **THEN** subsequent matching actions in that session do not prompt and unrelated scopes still require approval

### Requirement: Inspect and revoke permissions

A supported local backend SHALL expose `/permissions` with current approval mode and remembered tool/action grants. Revoking a grant SHALL persist and SHALL leave unrelated grants and global configuration unchanged.

#### Scenario: Revoke after resume

- **WHEN** a resumed session's remembered action is revoked
- **THEN** that action requires approval again in the session

### Requirement: Session modes respect policy

The TUI SHALL reset session approval modes when changing sessions and SHALL NOT auto-approve requests whose policy disallows automatic approval.

#### Scenario: Mandatory manual request

- **WHEN** auto-approve mode receives a mandatory manual request
- **THEN** the approval prompt remains visible

### Requirement: Complex shell scopes are exact

Compound or expansion-bearing commands SHALL NOT reuse the approval identity of a simple command prefix.

#### Scenario: Additional shell action

- **WHEN** `git status` has been remembered and a compound command adds another action
- **THEN** the compound command requires its own approval
