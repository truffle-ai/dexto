# Spec Delta

## Purpose

Protect cooperating one-shot MCP CLI edits from silently overwriting another successful configuration change.

## ADDED Requirements

### Requirement: Exclusive edit ownership

CLI add and remove commands SHALL own the selected configuration edit before loading its contents until commit and release. A competing edit SHALL return exit 2 with code `config_busy` and the safe message `MCP configuration is being edited. Retry after the current edit completes.` without changing configuration or another command's lock.

#### Scenario: Competing add commands

- **WHEN** one CLI add holds a configuration snapshot and another CLI add targets that file
- **THEN** the second returns `config_busy` without committing and can preserve both entries by retrying after the first completes

#### Scenario: Remove competes with add

- **WHEN** a remove owns the configuration edit while add targets the same file
- **THEN** add returns `config_busy` and the remove's result is preserved

### Requirement: Scoped release and truthful failure

An edit SHALL release only its own acquired lock on completion or failure. If cleanup fails after commit, it SHALL return exit 2 with safe `config_lock_cleanup_failed` diagnostics stating that the edit may already have committed. An already-failed edit SHALL retain its original error. It SHALL NOT report successful cleanup while its lock remains.

#### Scenario: Rejected edit releases ownership

- **WHEN** an acquired edit rejects invalid or duplicate command data
- **THEN** another edit can acquire the same configuration immediately afterward

#### Scenario: Release fails after commit

- **WHEN** configuration commits but its owned lock cannot be removed
- **THEN** the command returns a cleanup failure instead of success and preserves existing lock contents

#### Scenario: Operation and cleanup both fail

- **WHEN** invalid edit data is rejected and lock release also fails
- **THEN** the original edit error remains the outcome and no success is reported

### Requirement: Compatibility and explicit recovery

Read-only commands SHALL remain unlocked. Remove of missing configuration SHALL retain its existing safe read failure. Existing sidecars SHALL NOT be reclaimed automatically based on PID or age; manual recovery SHALL be documented for abrupt termination. Protection SHALL be described as applying to cooperating CLI writers, without claiming external-editor conflict detection.

#### Scenario: Read while an edit is busy

- **WHEN** list reads a valid configuration with an existing edit lock
- **THEN** it retains its existing outcome without modifying the lock

#### Scenario: Abandoned lock

- **WHEN** an existing lock has no active owner after abrupt termination
- **THEN** later edits remain busy until explicit manual recovery removes the lock
