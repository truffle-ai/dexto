## ADDED Requirements

### Requirement: Failed candidate cleanup

MCPManager SHALL attempt to disconnect a candidate when connection or restart fails. It SHALL remove registrations and caches owned by that candidate without removing another registered client. Cleanup failure SHALL NOT replace the original connection error.

#### Scenario: Connected candidate rejected during registration

- **WHEN** a candidate connects but registration rejects its sanitized server name
- **THEN** transport disconnection is attempted and other registered servers remain usable

#### Scenario: Initialization handshake failure

- **WHEN** a candidate fails its MCP initialization handshake
- **THEN** cleanup is attempted and the connection failure remains observable

#### Scenario: Cleanup also fails

- **WHEN** candidate disconnect fails during rollback
- **THEN** the caller and recorded failure still describe the original connection error

### Requirement: Retryable failed restart

MCPManager SHALL retain the saved server configuration after a failed restart so the caller can retry using the existing API.

#### Scenario: Failed restart followed by retry

- **WHEN** a restarted candidate fails and the cause is corrected
- **THEN** restart can reconnect from the retained configuration and clear the recorded error

### Requirement: Existing standalone contracts remain compatible

The change SHALL preserve public API signatures, permission defaults, naming rules, and caller-owned authorization for direct MCP calls.

#### Scenario: Standalone tool execution

- **WHEN** an application connects and executes a tool directly
- **THEN** no agent, LLM, Cloud account, or implicit CLI approval flow is required
