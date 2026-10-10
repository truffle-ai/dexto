## Purpose

Define the grouped MCP host's upstream connection ownership and faithful forwarding of advertised MCP capabilities.

## ADDED Requirements

### Requirement: Startup connection policy

The aggregation host SHALL honor strict startup for enabled connections without modifying caller configuration.

#### Scenario: Strict failure

- **WHEN** an enabled upstream fails during strict startup
- **THEN** initialization fails and releases already acquired connections

#### Scenario: Lenient partial startup

- **WHEN** a lenient upstream fails and another upstream connects
- **THEN** the host exposes capabilities from the connected upstream

### Requirement: Protocol fidelity

The aggregation host SHALL preserve upstream tool schemas, capability metadata, tool error results, structured results, resource content and prompt arguments.

#### Scenario: Structured tool error

- **WHEN** an upstream tool returns an error result with structured content
- **THEN** the connecting client receives the same error result and structured content

#### Scenario: Prompt arguments

- **WHEN** a client supplies declared prompt arguments
- **THEN** the owning upstream receives those arguments unchanged

### Requirement: Stable capability identity

The aggregation host SHALL advertise a fixed startup capability snapshot bound to each owning upstream and SHALL reject ambiguous server, tool or resource identities or duplicate prompt names.

#### Scenario: Ambiguous discovery

- **WHEN** discovery contains capabilities that cannot be mapped to a unique advertised identity
- **THEN** startup fails and acquired resources are released

#### Scenario: Stable binding

- **WHEN** manager discovery later changes
- **THEN** an advertised tool still routes to its original upstream identity

### Requirement: Owned shutdown

The aggregation host SHALL release its downstream server and upstream connections through idempotent explicit close and transport close.

#### Scenario: Repeated close

- **WHEN** explicit close and transport close occur repeatedly
- **THEN** owned cleanup completes once without leaving upstream processes running

### Requirement: Request cancellation

The aggregation host SHALL forward request cancellation to the owning upstream through the SDK abort signal.

#### Scenario: Cancelled tool request

- **WHEN** a client cancels an active tool request
- **THEN** the owning upstream receives cancellation
