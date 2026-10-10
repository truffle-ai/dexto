## Purpose

Provide deterministic MCP server setup and direct operations for users and automation without creating an agent or requiring a model.

## ADDED Requirements

### Requirement: Independent configuration

The CLI SHALL read MCP servers from the selected MCP-only YAML file. An explicit subcommand `--config` SHALL override parent `--config`; absent both, standalone commands SHALL use `.dexto/mcp.yml`. Add and remove SHALL preserve unrelated YAML fields and comments, and add SHALL preserve literal environment templates. Duplicate additions SHALL fail unless replacement is explicit.

#### Scenario: Parent configuration selection

- **WHEN** `--config` appears before a standalone subcommand
- **THEN** the selected file is used unless that subcommand explicitly supplies its own file

#### Scenario: Portable setup

- **WHEN** a server is added with environment templates
- **THEN** the stored configuration retains those templates without writing expanded credentials

### Requirement: Safe configured discovery

Configured server listing SHALL disclose only name, transport, enabled state and configured/disabled status, without connecting or displaying credential-bearing fields.

#### Scenario: Disabled server

- **WHEN** a disabled server is listed
- **THEN** its disabled status is returned without starting the server

### Requirement: One-shot operations

Connection probes, discovery and tool calls SHALL close all connections owned by the command on success and failure. Tool calls SHALL select the explicit server and upstream tool name. The probe SHALL report closed ownership.

#### Scenario: Completed direct call

- **WHEN** an explicitly selected tool completes
- **THEN** its result is returned and the owned connection is closed

#### Scenario: Failed handshake

- **WHEN** server initialization fails
- **THEN** the command fails and closes its owned process or transport

### Requirement: Noninteractive outcomes

After command parsing succeeds, commands SHALL support JSON stdout and distinct nonzero outcomes for configuration, connection and operation failures without model setup or interactive prompts. Existing `mcp --group-servers` SHALL remain available.

#### Scenario: Parser error

- **WHEN** a command has an unknown option or missing operand
- **THEN** the standard CLI parser reports the error on stderr with exit status 1 before the action runs

#### Scenario: Server tool error

- **WHEN** a tool returns an MCP error result
- **THEN** the command reports an operation failure rather than success and preserves the complete MCP result, including its error content

### Requirement: Convenient setup forms

Add SHALL accept a stdio executable with repeated arguments/environment assignments or a remote URL with repeated header assignments, as well as a mutually exclusive JSON configuration form.

#### Scenario: Agent configures a remote server

- **WHEN** an agent supplies a remote URL and header templates
- **THEN** it can discover and call the selected server without login or model configuration

### Requirement: Shared gateway configuration

The existing aggregation gateway SHALL accept an explicit MCP-only configuration file using the same loader as direct commands. Its initialized server owner SHALL close on signals, stdin EOF and downstream transport closure. Omitting the file SHALL retain legacy agent configuration resolution.

#### Scenario: MCP-only gateway

- **WHEN** a client starts the aggregation gateway with an MCP-only file
- **THEN** configured tools are exposed without agent/model setup and owned connections close when the client disconnects
