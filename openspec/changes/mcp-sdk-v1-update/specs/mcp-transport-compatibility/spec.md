# Spec Delta

## Purpose

Define remote MCP redirect behavior and preserve direct client composition across supported dependency updates.

## ADDED Requirements

### Requirement: Remote redirects stay within the configured origin

Remote MCP transports SHALL use the origin-restricted redirect default. Method-preserving same-origin redirects remain supported. A redirect to another host or port SHALL fail without contacting that target; callers must configure the final endpoint URL.

#### Scenario: Same-origin HTTP redirect

- **WHEN** a configured HTTP endpoint returns a method-preserving redirect within its origin
- **THEN** initialization, tool calls and resource reads succeed with configured headers preserved

#### Scenario: Cross-origin HTTP redirect

- **WHEN** a configured HTTP endpoint redirects to a different port
- **THEN** connection fails without contacting the target and the local client remains disconnected

### Requirement: Direct connected-client composition remains available

The connected-client API SHALL preserve SDK tool-call options, complete tool results, resource reads and caller-owned disconnect lifecycle.

#### Scenario: Direct HTTP tool and resource composition

- **WHEN** a caller connects with configured headers, calls a tool with progress timeout options, reads a resource and disconnects
- **THEN** headers and complete result metadata are retained and the client reports disconnected after cleanup
