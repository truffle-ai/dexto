## ADDED Requirements

### Requirement: Noninteractive approval response

Headless runs SHALL immediately deny requests requiring interactive approval with an actionable message, without waiting for input or producing a missing-handler configuration error.

#### Scenario: Mandatory approval

- **WHEN** a headless tool explicitly disallows automatic approval
- **THEN** its protected side effect is prevented and the tool receives an interactive-approval-unavailable denial

### Requirement: Existing automatic execution and completion

Headless runs SHALL retain ordinary automatic tool execution, disabled elicitation, existing JSON/JSONL contracts, and recoverable tool-denial behavior.

#### Scenario: Ordinary tool

- **WHEN** a tool permits automatic approval
- **THEN** it executes without prompting or consulting the denial handler

#### Scenario: Recovery after denial

- **WHEN** a run recovers from a denied tool and completes through another approach
- **THEN** final status and exit semantics reflect run completion rather than treating every tool denial as fatal
