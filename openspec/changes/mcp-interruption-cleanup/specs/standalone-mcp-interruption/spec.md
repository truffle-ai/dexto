# Spec Delta

## Purpose

Define interruption and cleanup of command-owned connections for one-shot MCP CLI operations without changing reusable Core process behavior.

## ADDED Requirements

### Requirement: First signal determines interrupted outcome

One-shot connecting MCP commands SHALL preserve the first received SIGINT or SIGTERM until owned cleanup completes. They SHALL return one safe JSON outcome when JSON output is requested, with `server`, `signal` and `error` containing code `mcp_interrupted` and message `MCP operation interrupted.`. SIGINT SHALL exit 130 and SIGTERM SHALL exit 143. Repeated signals SHALL NOT replace the first outcome or initiate duplicate cleanup.

#### Scenario: Interrupt an active request

- **WHEN** SIGTERM reaches a one-shot MCP command during an active request
- **THEN** the request receives cancellation and the CLI closes its owned connection before returning interrupted JSON and exit 143

#### Scenario: Repeated different signals

- **WHEN** SIGINT is followed by SIGTERM while cleanup is pending
- **THEN** the command retains SIGINT and exit 130 and runs its owned cleanup once

### Requirement: Startup interruption preserves candidate ownership

An interruption during connection or discovery SHALL mark the command interrupted and await the original startup operation's settlement before cleanup. The requested operation SHALL NOT execute after startup completes when interruption has already been recorded. The CLI SHALL NOT claim immediate startup cancellation; existing SDK handshake/discovery deadlines govern the pending startup steps.

#### Scenario: Interrupt delayed initialization

- **WHEN** SIGTERM arrives before an upstream initialization reply is released
- **THEN** the CLI waits for startup settlement, skips the requested tool invocation, closes the owned child and returns exit 143

### Requirement: Scoped owner cleanup and limits

The CLI SHALL dispose its own signal listeners on success, connection failure, operation failure or interruption and close its manager before destroying its logger. Core SHALL NOT install process signal handlers. Cancellation SHALL NOT promise rollback of an operation already performed by the server. SIGKILL, abrupt OS termination and unresponsive cleanup SHALL remain outside the graceful cleanup guarantee.

#### Scenario: Normal and failed outcomes

- **WHEN** a one-shot command completes normally or fails without a signal
- **THEN** its existing JSON/exit semantics remain unchanged and no owned signal listener remains
