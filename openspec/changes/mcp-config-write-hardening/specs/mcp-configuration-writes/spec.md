## Purpose

Standalone MCP configuration edits use private atomic replacement on POSIX and retain existing file ACLs through in-place writes on Windows. Both retain literal credential templates and unrelated document content.

## ADDED Requirements

### Requirement: Private atomic configuration replacement

On POSIX, successful standalone add/remove edits SHALL write the replacement through a unique exclusively created temporary file in the selected file's directory before renaming it over the selected path. On POSIX the resulting file SHALL have mode `0600`, including when the previous file was `0644`. Replacement SHALL preserve unrelated YAML fields/comments and literal credential templates.

#### Scenario: Add to an existing permissive configuration

- **WHEN** a valid server is added to an existing `0644` configuration on POSIX
- **THEN** the resulting configuration has mode `0600`, retains unrelated comments and fields, and contains the server's unexpanded credential templates

#### Scenario: Remove from an existing permissive configuration

- **WHEN** a configured server is removed from an existing `0644` configuration on POSIX
- **THEN** only that entry is removed and the resulting file has mode `0600`

### Requirement: Windows file ACL preservation

On Windows, standalone add/remove SHALL retain the existing in-place writer and existing file ACLs. New files SHALL use the existing default filesystem ACL behavior. This requirement does not provide atomic replacement or preservation of original content on failed in-place writes.

#### Scenario: Edit a restrictive existing Windows configuration

- **WHEN** actual CLI add/remove edits an existing Windows file with a restrictive file ACL under a broader parent ACL
- **THEN** both successful edits retain the original file security descriptor

### Requirement: Observed leaf symlink refusal

Standalone add/remove SHALL reject a leaf symlink observed at the edit boundary, including a dangling symlink, with exit status `2` and the safe `config_write_failed` outcome. Read-only commands SHALL retain their existing behavior. This requirement does not provide a general filesystem race, parent-directory ownership, or concurrent mutation guarantee.

#### Scenario: Edit selects a leaf symlink

- **WHEN** add/remove observes an existing or dangling leaf symlink as the selected configuration
- **THEN** the edit fails without modifying that symlink or its target

### Requirement: Failed replacement preserves the original configuration

On POSIX, a failed temporary write or rename SHALL leave the original configuration unchanged and SHALL return a safe `config_write_failed` outcome without raw filesystem error text. The writer SHALL attempt to close and remove its owned temporary file; cleanup failures SHALL NOT replace the original failure.

#### Scenario: Partial temporary write or rename fails

- **WHEN** temporary writing or replacement fails and cleanup remains available
- **THEN** the original YAML remains unchanged, the owned temporary file is removed, and the CLI returns the safe configuration-write outcome
