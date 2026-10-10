## Purpose

Keep MCP chat and agent-card discovery aligned with the available agent selected by a switching host while preserving static integrations.

## ADDED Requirements

### Requirement: Current host context

An MCP server initialized with host getters SHALL select the current available agent when a chat call begins and SHALL read the current card for each agent-card resource request.

#### Scenario: Successful agent switch

- **WHEN** the host successfully switches to a replacement agent
- **THEN** subsequent MCP chat calls execute on the replacement and card reads describe the replacement

#### Scenario: Failed agent switch

- **WHEN** replacement preparation fails and the host retains the original agent
- **THEN** subsequent MCP requests continue to select the original agent and card

#### Scenario: Unavailable host

- **WHEN** the host is switching agents or has stopped
- **THEN** new MCP requests report its availability error without creating a session or returning a stale card

### Requirement: Per-call session ownership

Each MCP chat call SHALL use the agent selected at entry for session creation, execution and cleanup.

#### Scenario: Context changes during a call

- **WHEN** the host's current agent changes after a call selects an agent
- **THEN** that call's ephemeral session is executed and cleaned up on the selected agent

### Requirement: Static integration compatibility

The existing three-argument MCP initializer and standalone card-resource initializer SHALL retain their static agent and card behavior. The MCP protocol name/version negotiated at connection initialization SHALL remain fixed for that connection.

#### Scenario: Static caller

- **WHEN** an integration initializes MCP without live host getters
- **THEN** chat calls and card reads use the original agent and card
