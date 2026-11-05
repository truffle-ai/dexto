## ADDED Requirements

### Requirement: Initial sign-in requests normal task permissions

Browser and device sign-in SHALL request the existing read scopes plus `cloud:read`, `sessions:write`, `automations:write` and `projects:write`, preserving explicitly requested extras without duplicates. Unrelated write scopes SHALL NOT be added automatically. Persisted scopes SHALL come from the token response.

#### Scenario: Device login for an agent task

- **WHEN** the CLI starts a device sign-in without extra scopes
- **THEN** one authorization request includes chat, Loop and Project writes alongside reads
- **AND** billing top-up, secret import, approval answering and other writes remain absent

#### Scenario: Browser login with an extra scope

- **WHEN** the CLI starts browser sign-in with `drive:write`
- **THEN** the same task permissions and `drive:write` are requested in one consent flow
- **AND** the saved login reflects only scopes returned by the server
