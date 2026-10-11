# Spec Delta

## Purpose

Expose configured MCP capabilities over an authenticated network interface without requiring an agent, model or account.

## ADDED Requirements

### Requirement: Agent-independent HTTP hosting

The CLI SHALL offer opt-in Streamable HTTP aggregation of configured stdio or remote MCP servers without constructing an agent or requiring model credentials or account login. Stdio SHALL remain the default interface.

#### Scenario: Remote client uses a local tool

- **WHEN** an authenticated MCP client connects to a gateway configured with a local stdio server
- **THEN** it can discover and call its tools with original schemas and MCP result semantics

### Requirement: Explicit host authentication

HTTP gateway startup SHALL default to an open literal loopback listener. A supplied bearer key SHALL enable authentication for every MCP request before body parsing or operation forwarding. Other bind addresses SHALL require a bearer key unless the caller explicitly disables built-in authentication. Credentials SHALL NOT appear in readiness output or logs.

#### Scenario: Missing credential

- **WHEN** HTTP hosting on a non-loopback address is requested without a bearer credential or an explicit authentication opt-out
- **THEN** startup fails without leaving upstream processes or a listener running

#### Scenario: Unauthorized invocation

- **WHEN** a key-protected gateway receives a missing or incorrect bearer credential
- **THEN** the gateway returns an unauthorized response and does not invoke upstream tools

### Requirement: Shared upstream ownership

The host SHALL own upstream connections independently from downstream requests. Request completion or client disconnection SHALL release that request's resources without closing upstreams used by other callers. Host shutdown or failed startup SHALL clean up owned listeners, connections and subprocesses.

#### Scenario: Independent callers

- **WHEN** one client disconnects and another issues a request
- **THEN** the remaining client can continue to discover and call the same upstream tools

#### Scenario: Shutdown

- **WHEN** the gateway is stopped
- **THEN** its listener and owned local MCP processes terminate

### Requirement: Fixed discovery and cancellation

The host SHALL preserve the existing startup snapshot of tools, resources and prompts. HTTP requests SHALL support propagated cancellation on client disconnection. The host SHALL document its stateless behavior and caller authorization responsibility.

#### Scenario: Upstream capabilities change

- **WHEN** an upstream changes its capabilities after startup
- **THEN** the published catalog stays fixed until the gateway restarts

#### Scenario: Interrupted call

- **WHEN** a client disconnects during a forwarded request
- **THEN** cancellation is propagated for that request without stopping unrelated callers

### Requirement: Explicit open hosting

An open loopback gateway SHALL work without credentials. An explicit authentication opt-out SHALL override a configured key and make network exposure the operator's responsibility.

#### Scenario: Local setup

- **WHEN** a caller starts a default loopback gateway with no key
- **THEN** a local MCP client can discover and execute configured capabilities without authentication

#### Scenario: External authentication

- **WHEN** a caller explicitly disables built-in authentication for a network-facing listener
- **THEN** the gateway permits requests without its bearer key and documents the external authorization responsibility

### Requirement: Local HTTP request origin boundary

The loopback gateway SHALL reject requests addressed to an unexpected host and requests with an unexpected browser origin before forwarding operations.

#### Scenario: Rebinding request

- **WHEN** a loopback listener receives a request with an unrelated Host header
- **THEN** it rejects the request without allocating an upstream operation

#### Scenario: Cross-origin browser request

- **WHEN** an HTTP request includes an Origin different from the listener origin
- **THEN** the gateway rejects the request
