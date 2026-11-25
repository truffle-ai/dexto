## Why

Agents are the cloud CLI's main users, and its `--json` output has several shapes, depending on the command family (DEXTO-3899, 24 Nov CLI agent sweep on dexto 2.5.2):

- Lists come wrapped in `{data}`, `{apps}`, `{applications, deployments}`, `{agents}`, `{computers}`, `{connections}`, `{automations, nextCursor}`, `{sessions, skills}` or `{results}`.
- The next-page cursor is called `next_after`, `nextCursor` or `next_cursor`.
- `/v1` and CLI-built objects use snake_case keys. Workspace-tool results are printed as the tool returns them, in camelCase. `chat list` mixes both.
- The same value has two names: `credits balance` prints `creditsUsd`, `billing` prints `balance_usd`.
- A malformed id exits 5 (`not_found`) for some commands and 2 (`invalid_input`) for others.

An agent has to learn each command's shape separately. One shape removes that.

## What Changes

- **BREAKING** Every list command prints `{data: [...], has_more, next_after}` in JSON. A list that isn't paged prints `has_more: false, next_after: null`. Other top-level facts, such as `deployments` beside a list of applications, stay as sibling keys. The deprecated `/v1` `next_cursor` alias is no longer printed.
- **BREAKING** Every JSON key the CLI prints is snake_case. The CLI converts keys when it prints, so the Dexto MCP and its tools keep their camelCase. Values that are someone's data keep their keys: tool input and JSON schemas, `_meta`, record `data`, `metadata`, headers and env.
- **BREAKING** A malformed id exits 2 with error code `invalid_input`, before any network call. A well-formed id that matches nothing exits 5 (`not_found`). An unknown `cloud models get` model now exits 5 instead of 2.
- `profile get` and `profile set` print the profile itself, not `{profile}`.
- A contract test runs every list command against a fake server and checks the envelope and the key case.
- The `dexto` CLI release is a major version. Its changeset is the release note, and it lists every renamed key and changed shape.

## Capabilities

### New Capabilities

- `cli-json-shape`: one JSON output contract for every cloud CLI command: the list envelope, snake_case keys and the malformed-id exit code.

### Modified Capabilities

None.

## Impact

- `packages/cli/src/cli/cloud` changes: the output layer (`output.ts`), the commands that print lists or records, and the id checks.
- The Dexto MCP, the `/v1` API and `@dexto/cloud-client` do not change.
- Input is unchanged. Tool input passed with `--data` keeps the tool's own key names.
- Scripts that parse today's camelCase or wrapped lists must update. The release note lists every change.
