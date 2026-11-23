## ADDED Requirements

### Requirement: Session modes

Every session SHALL offer the modes Asks you, Plan, Accept edits and Full access, start in the agent's `permissions.mode`, and switch with `session/set_mode`. No mode SHALL approve a request that the TUI's matching mode would ask about.

#### Scenario: Modes offered

- **WHEN** the client creates, loads or resumes a session
- **THEN** the response lists the four modes with the configured mode current, and an unknown mode id is rejected as invalid params

#### Scenario: Full access keeps limits

- **WHEN** the session is in Full access and a tool marked `autoApproval: 'disallowed'` runs
- **THEN** the client still gets a permission request

#### Scenario: Full access approves

- **WHEN** the session is in Full access and an ordinary approval-gated tool runs
- **THEN** it runs without a permission request

#### Scenario: Accept edits uses the session's workspace

- **WHEN** the session is in Accept edits
- **THEN** a file edit inside the session's workspace runs without asking, and other approval-gated tools still ask

#### Scenario: Plan

- **WHEN** the client sends a prompt in Plan
- **THEN** the first prompt carries plan mode's instructions, and an approved plan review moves the session to Asks you with `current_mode_update`

### Requirement: Slash commands

Sessions SHALL announce the agent's user-invocable prompts with `available_commands_update`, and a prompt that starts with `/name` SHALL run that prompt with its `key=value` arguments and context.

#### Scenario: Command runs

- **WHEN** the client sends `/greet the team` and `greet` is a user-invocable prompt
- **THEN** the agent runs the resolved prompt instead of the literal text

### Requirement: Context usage

Each turn SHALL end with a `usage_update` giving the context tokens used and the model's context window, and the session's estimated cost when known.

#### Scenario: Usage after a turn

- **WHEN** a prompt turn ends
- **THEN** the client gets a `usage_update` with `used` greater than zero and `size` greater than `used`
