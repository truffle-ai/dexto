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

Interactive non-JSON recovery SHALL list the exact scope set produced by sign-in discovery before starting authorization: current defaults, retained grants, a missing scope and chat sync when enabled. Declining SHALL start no authorization request and SHALL NOT retry the command. Headless or JSON commands SHALL exit 3 naming a missing scope and the explicit login command.

#### Scenario: Direct computer or Loop work needs another scope

- **WHEN** an interactive command lacks `computers:write` or `automations:write`
- **THEN** the prompt lists the complete union the approval page will request
- **AND** accepting re-signs in for that union and retries once
- **AND** the other step-up scope is not silently added

#### Scenario: No interactive approval

- **WHEN** a headless or JSON command lacks one of these scopes
- **THEN** it exits 3 with that scope and a login command without starting sign-in

### Requirement: The terminal shows a request as the approval page does

Wherever the CLI shows a sign-in request, it SHALL lay it out as the approval page does (consent variant C, "Plain rows"): labelled rows for Account, Organization, Code, From and Access, in that order. Account SHALL name the signed-in email when known; Organization SHALL name the requested organization, or say the page chooses it; Code SHALL appear once there is a device code; From SHALL name this computer; Access SHALL count the permissions and, on a step-up, name every one. Server-supplied text SHALL be stripped of control characters.

#### Scenario: Device sign-in

- **WHEN** `dexto login --device` receives a device code
- **THEN** the terminal shows the Account, Organization, Code, From and Access rows with the link to open

#### Scenario: Step-up prompt

- **WHEN** an interactive command asks to sign in again for a missing scope
- **THEN** the prompt shows the Account, Organization, From and Access rows, Access naming every requested scope, before asking to continue
