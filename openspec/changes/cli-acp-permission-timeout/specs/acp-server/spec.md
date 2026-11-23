## MODIFIED Requirements

### Requirement: Tool calls and permissions

Dexto tool calls SHALL be reported as ACP tool calls, and Dexto approvals SHALL be asked through `session/request_permission`. A permission request SHALL be withdrawn when its turn is cancelled or when `permissions.timeout` passes unanswered.

#### Scenario: Allowed

- **WHEN** an approval-gated tool runs and the client allows it
- **THEN** the tool call is reported before the permission request, the tool runs, and the call ends `completed`

#### Scenario: Rejected

- **WHEN** the client rejects the permission
- **THEN** the tool does not run and the call ends `failed`

#### Scenario: Timed out

- **WHEN** the agent config sets `permissions.timeout` and the client does not answer the permission request in time
- **THEN** the request is withdrawn with `$/cancel_request`, the tool does not run, its call ends `failed` as timed out, and the turn continues

#### Scenario: Cancelled while asking

- **WHEN** the client cancels the turn while a permission request is unanswered
- **THEN** the request is withdrawn with `$/cancel_request`, the tool does not run, and the prompt ends `cancelled`
