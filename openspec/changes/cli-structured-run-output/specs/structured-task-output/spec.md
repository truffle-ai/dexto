## ADDED Requirements

### Requirement: Explicit output format

The CLI SHALL accept `text`, `json`, and `jsonl` for `dexto run --format`, default to text, and reject unsupported formats before agent startup.

#### Scenario: Existing invocation

- **WHEN** the user runs a task without `--format`
- **THEN** stdout contains the final assistant text and human diagnostics remain on stderr

#### Scenario: Unsupported format

- **WHEN** a caller requests an unsupported output format
- **THEN** the command fails before bootstrapping an agent

### Requirement: Terminal JSON result

JSON mode SHALL emit exactly one version-1 JSON object identifying completed or failed status. Completed results SHALL include final content and session identity. Failures SHALL include an error message and exit nonzero, including startup failures, empty prompts, absent final responses, and fatal errors after a response.

#### Scenario: Successful task

- **WHEN** a task returns final content in JSON mode
- **THEN** stdout is one completed JSON result and no plain assistant text

#### Scenario: Startup failure

- **WHEN** agent construction fails in JSON mode
- **THEN** stdout is one failed JSON result and the command exits nonzero

### Requirement: Incremental JSONL output

JSONL mode SHALL emit version-1 objects for selected streaming message, tool, warning, and error events, followed by exactly one terminal complete or error object. Terminal completion SHALL include final content, including when no message delta was emitted. Recoverable errors SHALL NOT alone make a successful run fail.

#### Scenario: Stream and completion

- **WHEN** a task emits message deltas and then a final response
- **THEN** stdout contains parseable event lines followed by one terminal completion containing final content

#### Scenario: Fatal error after response

- **WHEN** a stream emits a final response and then a fatal error
- **THEN** the terminal object identifies failure and the process exits nonzero
