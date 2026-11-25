## Purpose

Give the dexto CLI and Core the hosted app's two permission modes, Full access and Asks you.

## ADDED Requirements

### Requirement: Two permission modes

`permissions.mode` SHALL accept `full-access` and `asks-you`. The default SHALL be `full-access`. Interfaces SHALL label them "Full access" and "Asks you".

#### Scenario: Default mode

- **WHEN** an agent config omits `permissions.mode`
- **THEN** the validated mode is `full-access`

### Requirement: Deprecated values

For one release, `auto-approve` SHALL map to `full-access` and `manual` SHALL map to `asks-you`. Each SHALL produce a deprecation warning that names the new value. Unknown values SHALL be rejected.

#### Scenario: Old manual value

- **WHEN** a config or `--permissions-mode` flag uses `manual`
- **THEN** the agent runs in `asks-you` and a warning names `asks-you`

#### Scenario: Old auto-approve value

- **WHEN** a config or `--permissions-mode` flag uses `auto-approve`
- **THEN** the agent runs in `full-access` and a warning names `full-access`

### Requirement: Asks you asks before changes

In `asks-you`, the agent SHALL ask before running a shell command and before writing or editing a file, including files inside the workspace. Reading files inside the workspace SHALL NOT ask.

#### Scenario: File edit inside the workspace

- **WHEN** the agent edits a workspace file in `asks-you` with no prior approval
- **THEN** an approval request is raised before the file changes

#### Scenario: Shell command

- **WHEN** the agent runs a shell command in `asks-you` with no prior approval
- **THEN** an approval request is raised before the command runs

### Requirement: Full access does not ask

In `full-access`, ordinary file edits and shell commands SHALL run without an approval request. Mandatory (always-ask) approvals SHALL still ask.

#### Scenario: File edit and shell command

- **WHEN** the agent edits a workspace file and runs a shell command in `full-access`
- **THEN** no approval request is raised
