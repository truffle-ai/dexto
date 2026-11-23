## ADDED Requirements

### Requirement: Tool display

Tool calls SHALL carry an ACP tool kind from the tool's Dexto activity category, and file changes and shell results SHALL be shown as ACP diff and command content.

#### Scenario: Edit

- **WHEN** an approval-gated tool that edits a file runs
- **THEN** its tool call has kind `edit`
- **AND** the permission request and the completed result carry an ACP diff for the file's absolute path

#### Scenario: Session folder inside a Dexto project

- **WHEN** the session folder sits below its Dexto project root and a tool edits a relative path
- **THEN** the tool call location, the permission preview and the result name the file inside the session folder, where the tool writes it

#### Scenario: Shell command

- **WHEN** a foreground shell command finishes
- **THEN** its result shows the command, its output and its exit code
- **AND** an approval preview or a background start, which has no output yet, stays text

#### Scenario: Other tools

- **WHEN** a tool has no activity category that maps to an ACP kind
- **THEN** its kind is `other` and its result is text
