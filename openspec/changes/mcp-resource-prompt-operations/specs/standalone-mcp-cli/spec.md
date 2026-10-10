## Purpose

Allow local users and automation to consume resource and prompt content from explicitly selected MCP servers.

## ADDED Requirements

### Requirement: Direct resource reads

The CLI SHALL read an exact selected server resource URI and return the complete MCP result through JSON output.

#### Scenario: Resource content

- **WHEN** a configured server supplies a resource for the requested URI
- **THEN** all result content is returned and the command-owned connection is closed

### Requirement: Direct prompt rendering

The CLI SHALL render an exact selected server prompt name using a JSON object of string-valued arguments, validated before connection.

#### Scenario: Valid prompt arguments

- **WHEN** string-valued arguments are supplied
- **THEN** the full rendered prompt result is returned and the owned connection is closed

#### Scenario: Invalid prompt arguments

- **WHEN** arguments are malformed JSON, not an object or contain non-string values
- **THEN** the command returns an invalid-arguments JSON outcome with exit status 2 without connecting

### Requirement: Shared direct-operation boundary

Both commands SHALL use existing parent/leaf configuration selection, safe error outcomes and owned cleanup. Protocol failures SHALL return exit status 4 without exposing raw error details.

#### Scenario: Selected configuration

- **WHEN** parent --config selects a file for either command
- **THEN** execution uses that file unless an explicit leaf --config overrides it

#### Scenario: Upstream failure

- **WHEN** the selected resource read or prompt rendering fails
- **THEN** the command reports a safe operation failure and closes its owned connection
