## ADDED Requirements

### Requirement: Operational MCP logs exclude raw data

Core MCP client and manager logs SHALL omit raw transport configuration, remote URLs, resource URIs, capability schemas/descriptions, prompt/resource arguments and results, elicitation content and provider error payloads. Logs MAY retain operation labels, selected server/tool/prompt identifiers and fixed Core MCP error classifications.

#### Scenario: Stdio connection and resource notification

- **WHEN** a stdio server is connected with private arguments/environment and emits a resource update
- **THEN** Core logs describe the operation without those values while the resource event retains its URI

#### Scenario: Remote connection failure

- **WHEN** an HTTP or SSE connection fails with a configured URL or provider error containing private data
- **THEN** Core logs retain the selected server and connection failure classification without the raw URL or provider error

#### Scenario: Capability and elicitation data

- **WHEN** tools, prompts, resources or elicitation operations contain private data
- **THEN** Core diagnostics omit that data while callers receive the existing results and approval responses

### Requirement: Existing MCP contracts remain unchanged

The change SHALL preserve public APIs, transport/authentication behavior, error wrapping, recorded failures, event payloads, configuration inspection and agent permission semantics.

#### Scenario: Caller inspects a failed connection or configuration

- **WHEN** a caller uses the existing failure/configuration inspection methods
- **THEN** the original error details and raw configuration remain available to that caller rather than being replaced by the log projection
