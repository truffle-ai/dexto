## ADDED Requirements

### Requirement: Initial sign-in requests normal task permissions

Browser and device sign-in SHALL request the existing read scopes plus `cloud:read`, `runs:read`, `artifacts:read`, `sessions:write` and `projects:write`, preserving explicitly requested extras without duplicates. `computers:write` and `automations:write` SHALL remain step-ups and SHALL NOT be added automatically. Persisted scopes SHALL come from the token response.

#### Scenario: Device login for an agent task

- **WHEN** the CLI starts a device sign-in without extra scopes
- **THEN** one authorization request includes chat and Project writes alongside reads
- **AND** direct computer writes and Loop writes remain absent
- **AND** billing top-up, secret import, approval answering and other writes remain absent
- **AND** the request includes run-trace and storage-artifact reads even when workspace metadata omits them

#### Scenario: Browser login with an extra scope

- **WHEN** the CLI starts browser sign-in with `drive:write`
- **THEN** the same task permissions and `drive:write` are requested in one consent flow
- **AND** the saved login reflects only scopes returned by the server

### Requirement: Step-up shows the entire requested grant

Interactive non-JSON recovery SHALL list the exact scope set produced by sign-in discovery before starting authorization: current defaults, retained grants, the missing scopes and chat sync when enabled. Declining SHALL start no authorization request and SHALL NOT retry the command. Headless or JSON commands SHALL exit 3 naming the missing scopes and the explicit login command.

#### Scenario: Direct computer or Loop work needs another scope

- **WHEN** an interactive command lacks `computers:write` or `automations:write`
- **THEN** the prompt lists the complete union the approval page will request
- **AND** accepting re-signs in for that union and retries once
- **AND** the other step-up scope is not silently added

#### Scenario: No interactive approval

- **WHEN** a headless or JSON command lacks one of these scopes
- **THEN** it exits 3 with that scope and a login command without starting sign-in
