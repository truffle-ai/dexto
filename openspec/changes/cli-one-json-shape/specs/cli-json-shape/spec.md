## ADDED Requirements

### Requirement: One list envelope

Every cloud CLI command that prints a list SHALL print, in JSON, an object with `data` (the list), `has_more` (a boolean) and `next_after` (the cursor for `--after`, or null). A list that is not paged SHALL print `has_more: false` and `next_after: null`. Other facts about the list SHALL be sibling keys of `data`. The CLI SHALL NOT print a second cursor name such as `next_cursor` or `nextCursor`.

#### Scenario: Workspace-tool list

- **WHEN** an agent runs `dexto loops list --json` and the tool answers `{automations: [...], nextCursor: "c2"}`
- **THEN** the CLI prints `{data: [...], has_more: true, next_after: "c2"}`

#### Scenario: Unpaged list with a sibling fact

- **WHEN** an agent runs `dexto applications list --json`
- **THEN** the CLI prints `{data: [...applications], has_more: false, next_after: null, deployments: [...]}`

#### Scenario: /v1 page with a deprecated cursor

- **WHEN** `/v1/files` answers with both `next_after` and `next_cursor`
- **THEN** `dexto cloud files list --json` prints `next_after` and no `next_cursor`

### Requirement: snake_case keys

Every key the cloud CLI prints in JSON SHALL be snake_case, whether it comes from a workspace tool, `/v1` or the CLI itself. The values of keys that hold someone's data SHALL keep their keys as given: `_meta`, `arguments`, `input`, `input_schema`, `confirm_schema`, `output_schema`, `schema`, `metadata`, `headers`, `env`, `variables`, and `data` when its value is an object. Input SHALL NOT change: tool input passed with `--data` keeps the tool's own names.

#### Scenario: Workspace-tool rows

- **WHEN** `dexto chat list --json` prints a chat the tool returned as `{updatedAt, activeRunId}`
- **THEN** the row's keys are `updated_at` and `active_run_id`

#### Scenario: A tool's input schema

- **WHEN** `dexto workspace describe dexto_connection_finish --json` prints a schema with the property `attemptId`
- **THEN** the key `input_schema` is snake_case and the property inside it is still `attemptId`

#### Scenario: One name for one value

- **WHEN** an agent runs `dexto credits balance --json`
- **THEN** it prints `credits_usd`

### Requirement: Malformed and missing ids

A command given an id that cannot be an id of that kind SHALL fail before any network call with error code `invalid_input` and exit code 2. A well-formed id that matches nothing SHALL fail with `not_found` and exit code 5.

#### Scenario: Malformed chat id

- **WHEN** an agent runs `dexto chat get nope --json`
- **THEN** the CLI makes no request, prints an error with code `invalid_input` and exits 2

#### Scenario: Missing run

- **WHEN** an agent runs `dexto trace view <well-formed uuid>` and `/v1` answers 404
- **THEN** the CLI exits 5 with code `not_found`

#### Scenario: Unknown model

- **WHEN** an agent runs `dexto cloud models get no-such-model`
- **THEN** the CLI exits 5 with code `not_found`

### Requirement: The contract is tested

A test SHALL run every cloud list command against a fake server that answers in camelCase, and check its JSON for the list envelope and snake_case keys. The test SHALL fail when a command whose name ends in `list` has no case in it.

#### Scenario: A new list command

- **WHEN** a contributor adds a `list` command and no contract case for it
- **THEN** the contract test fails and names the command
