## Purpose

Keep CLI interfaces on the same configured agent permission policy and expose approvals that cannot be collected noninteractively.

## ADDED Requirements

### Requirement: Shared startup policy

The CLI SHALL honor configured permissions in TUI and headless mode. Global `--permissions-mode manual|auto-approve` SHALL override configuration in both interfaces; `--auto-approve` and `--bypass-permissions` SHALL select auto-approve. Conflicting manual and auto options SHALL fail. With no override, Core defaults and rules SHALL remain authoritative.

#### Scenario: Configured manual headless run

- **WHEN** a headless run uses manual permissions and a tool needs approval
- **THEN** the operation is not executed without an existing Core authorization

#### Scenario: Explicit automatic mode

- **WHEN** either interface selects auto-approve
- **THEN** ordinary approval-sensitive tools follow Core automatic policy and mandatory approvals remain enforced

#### Scenario: Contradictory options

- **WHEN** manual mode is combined with an auto-approval alias
- **THEN** the CLI rejects the options instead of silently choosing a mode

### Requirement: Noninteractive approval outcome

Headless runs SHALL expose unavailable approval as `approval_required` with correlation and actionable guidance. JSON SHALL include approval-required records; JSONL SHALL emit each record and retain them in the terminal result; text SHALL report them on stderr. Runs SHALL continue through Core recovery to completion without a new task cap.

#### Scenario: Approval unavailable and model recovers

- **WHEN** approval cannot be collected and the model produces a final response after denial
- **THEN** the output reports completion and the approval-required record without performing the blocked operation

#### Scenario: Legacy unscoped approval inside a task

- **WHEN** a custom tool requests approval without a session identifier during a headless task
- **THEN** output attributes the unavailable approval to the active run without granting authority or changing the original denial scope

### Requirement: Visible configured policy

The TUI SHALL display its configured Core approval mode independently of temporary interface shortcuts.

#### Scenario: Automatic configuration without a shortcut

- **WHEN** Core is configured to auto-approve and no session shortcut is active
- **THEN** the TUI displays the automatic configured policy
