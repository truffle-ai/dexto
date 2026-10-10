# Spec Delta

## Purpose

Allow standalone library hosts to invoke discovered MCP tools using literal identity and retain the complete protocol result and caller cancellation semantics.

## ADDED Requirements

### Requirement: Literal identity calls

Direct calls SHALL select the registered connection and upstream tool using the literal MCP descriptor identity, independently of aliases and discovery cache changes.

#### Scenario: Same tool on two servers

- **WHEN** two registered servers advertise the same tool or names containing the alias delimiter
- **THEN** the supplied literal connection/tool identity selects the requested upstream tool

### Requirement: Full protocol result

Direct calls SHALL return a typed full MCP tool result, retaining content, structuredContent, isError, metadata and protocol extension fields. Legacy agent execution SHALL retain its existing result/error behavior.

#### Scenario: Tool reports an error

- **WHEN** an upstream tool returns isError and structured content
- **THEN** the direct call returns that protocol result without converting it into an agent execution exception

### Requirement: Caller cancellation and saved timeout

Direct calls SHALL forward caller cancellation and use the saved restart configuration timeout for the connection name. Desired configuration SHALL NOT override it; externally registered clients without saved configuration SHALL retain the SDK timeout default.

#### Scenario: Abort an active call

- **WHEN** a caller aborts a pending direct call
- **THEN** the request rejects through SDK cancellation and the connected client remains usable

### Requirement: Connection ownership boundary

Direct calls SHALL reject absent connections and observed initialization or restart operations. Calls SHALL remain bound to the captured client rather than rerouting to a replacement. Direct callers SHALL own authorization independently of agent execution policy.

#### Scenario: Initializing connection

- **WHEN** a direct call targets a connection whose initialization has not settled
- **THEN** it rejects without invoking the upstream tool
