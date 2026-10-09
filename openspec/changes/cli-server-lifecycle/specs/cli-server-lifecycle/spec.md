## ADDED Requirements

### Requirement: Readiness reflects a bound listener

The CLI HTTP host SHALL resolve startup and announce success only after its listening socket is bound and its agent is initialized.

#### Scenario: Ready local server

- **WHEN** server mode starts on an available port
- **THEN** the success banner is followed by a reachable health endpoint

#### Scenario: Occupied port

- **WHEN** server mode attempts to bind an occupied port
- **THEN** startup fails with a nonzero exit and no server-running success banner

### Requirement: Owned shutdown and rollback

The CLI HTTP host SHALL offer idempotent stop that closes owned HTTP/MCP resources, invokes stop on each still-owned agent, and removes owned process listeners. Startup failure SHALL attempt cleanup of acquired host resources and invoke agent stop while preserving the original startup error. Cleanup SHALL attempt remaining resources even when one fails.

#### Scenario: Stop an active host

- **WHEN** the host is stopped twice or receives SIGTERM
- **THEN** resources are stopped once, the port is released, and owned process listeners are removed

#### Scenario: Startup rollback

- **WHEN** initialized resources are followed by a listening failure
- **THEN** the initialized agent and transports are cleaned up and no host process listeners remain

### Requirement: Portable agent behavior remains unchanged

The slice SHALL confine runtime changes to the CLI host and SHALL preserve Core contracts, agent approval defaults, and Cloud dependency pins.

#### Scenario: Cloud consumer boundary

- **WHEN** the slice is reviewed and validated
- **THEN** shared Core/server/image packages and Cloud consumers have no runtime changes
