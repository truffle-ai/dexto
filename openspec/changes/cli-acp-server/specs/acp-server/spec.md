## ADDED Requirements

### Requirement: ACP stdio server

`dexto acp` SHALL serve the configured Dexto agent as an ACP v1 agent on stdio, writing only protocol messages to stdout.

#### Scenario: Initialize

- **WHEN** a client sends `initialize`
- **THEN** the agent answers with its protocol version, its name and version, and support for loading sessions

### Requirement: Sessions and prompts

Each ACP session SHALL be a Dexto session; a prompt SHALL run the Dexto agent loop and stream its reply as session updates.

#### Scenario: Streamed reply

- **WHEN** a client prompts a session
- **THEN** reply text arrives as `agent_message_chunk` updates and the prompt ends with `end_turn`

#### Scenario: Load

- **WHEN** a client loads an existing session
- **THEN** its stored user and assistant text is replayed as message chunks before the load completes

#### Scenario: Busy session

- **WHEN** a client prompts a session whose previous prompt is still running
- **THEN** the new prompt is refused and the running prompt is unaffected

#### Scenario: Sessions in different directories

- **WHEN** a client opens sessions in two directories and prompts one of them
- **THEN** that prompt's tools run in its own session's directory
- **AND** a prompt in the other directory is refused while that turn runs

### Requirement: Tool calls and permissions

Dexto tool calls SHALL be reported as ACP tool calls, and Dexto approvals SHALL be asked through `session/request_permission`.

#### Scenario: Allowed

- **WHEN** an approval-gated tool runs and the client allows it
- **THEN** the tool call is reported before the permission request, the tool runs, and the call ends `completed`

#### Scenario: Rejected

- **WHEN** the client rejects the permission
- **THEN** the tool does not run and the call ends `failed`

### Requirement: Cancel

`session/cancel` SHALL stop the running prompt.

#### Scenario: Cancel mid-reply

- **WHEN** a client cancels while a reply streams
- **THEN** streaming stops and the prompt ends with `cancelled`

### Requirement: Model selection

Sessions SHALL offer a `model` config option with the session's model and the person's Dexto favorites and recents.

#### Scenario: Switch model

- **WHEN** a client sets the `model` option
- **THEN** later prompts in that session use the chosen model
