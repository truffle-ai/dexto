## ADDED Requirements

### Requirement: Local hosts register configured instruction files

The local host SHALL register validated file prompts with its existing LocalSkills implementation after resolving services, without replacing custom Skills implementations.

#### Scenario: Installed bundled agent loads its instructions

- **WHEN** an installed coding agent invokes skill_load for code-review
- **THEN** its configured instruction file is loaded through the Skills contract

#### Scenario: Custom implementation remains authoritative

- **WHEN** an image supplies a custom Skills implementation
- **THEN** configured file prompts do not modify its catalog or resolution behavior

### Requirement: Configured skills retain prompt identity and visibility

Configured file skills SHALL use prompt id/filename and namespace semantics, honor disable-model-invocation true in file frontmatter, and reflect subsequent file edits. Discovered skills SHALL retain precedence over configured files. Unshadowed conflicting configured identities SHALL fail explicitly.

#### Scenario: A workspace skill shadows duplicate configured files

- **WHEN** a usable workspace skill owns a configured identity
- **THEN** both listing and loading retain that workspace capability without breaking an unrelated configured skill

#### Scenario: A prompt becomes private

- **WHEN** its file frontmatter disables model invocation
- **THEN** the configured skill is neither listed nor loadable

### Requirement: A configured file does not grant directory access

Configured file skills SHALL expose instructions only, empty supportingFiles, hosted filesLocation and null baseDirectory. They SHALL refuse supporting-file reads and outside-parent symlink targets.

#### Scenario: A caller requests a sibling file

- **WHEN** skill_load requests a sibling path of a configured instruction file
- **THEN** the supporting-file read is refused
