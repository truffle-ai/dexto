## ADDED Requirements

### Requirement: Explicit configuration ownership

The manager SHALL provide opt-in registration, connection and forgetting of validated desired server configurations separately from legacy successful restart configuration.

#### Scenario: Reserved legacy name

- **WHEN** desired registration uses the name `__proto__`
- **THEN** it rejects with a typed MCP error without recording desired configuration
- **AND** names such as `constructor` and `toString` do not inherit prototype failures

#### Scenario: Disabled configuration

- **WHEN** a disabled configuration is registered
- **THEN** it is listed as disabled and configured connection rejects without creating a client
- **AND** the legacy configuration getter remains empty

#### Scenario: Reusable disconnection

- **WHEN** an explicitly configured entry is removed from active clients or disconnectAll completes
- **THEN** its desired registration remains until explicitly forgotten
- **AND** legacy caches and errors retain their existing clearing semantics

#### Scenario: Active configuration mutation

- **WHEN** configure or forget targets a registered client or an observed in-flight operation
- **THEN** the operation rejects without mutating desired configuration

#### Scenario: Configured connection ownership

- **WHEN** configured connection targets an unknown, disabled or active name
- **THEN** it rejects without starting another connection
- **AND** mutable legacy restart configuration cannot alter desired configuration

### Requirement: Safe configured status snapshots

The manager SHALL expose fresh readonly status values only for explicitly configured names, using configuredTransport for desired transport and fixed error codes for failed status.

#### Scenario: Desired and actual differ

- **WHEN** a legacy caller connects another configuration for an explicitly configured name
- **THEN** the snapshot reports registered connection state but configuredTransport still describes desired configuration
- **AND** it does not claim desired configuration was applied

#### Scenario: Failed then retried

- **WHEN** a configured connection fails and a subsequent attempt succeeds
- **THEN** status transitions failed to connecting to connected without exposing raw errors or credentials

#### Scenario: Overlapping attempts

- **WHEN** multiple legacy connection attempts for a configured name overlap
- **THEN** connecting takes precedence until every observed attempt settles
- **AND** existing connection scheduling is unchanged

#### Scenario: Legacy-only names

- **WHEN** legacy clients or errors have no explicit desired registration
- **THEN** they are absent from configured status snapshots
- **AND** existing agent status, client, configuration and error APIs remain unchanged
