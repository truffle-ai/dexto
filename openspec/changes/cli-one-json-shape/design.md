## Context

Cloud CLI commands print through `Output` (`packages/cli/src/cli/cloud/output.ts`) with `list`, `record` and `result`. A few, such as `connections` and the chat follow stream, call `JSON.stringify` themselves. Workspace-tool results come back from `queryWorkspaceTool` in the tool's camelCase. About 25 command files parse them with zod schemas in that case before printing. `/v1` pages carry `object`, `has_more`, `next_after` and, for files and media generations, a deprecated `next_cursor`.

The decision on DEXTO-3899 (Progress, 24 Nov) fixes the contract: one list envelope, snake_case keys at the CLI boundary, exit 2 for a malformed id and exit 5 for a missing one, shipped as a major CLI version with a list of renamed keys.

## Goals / Non-Goals

Goals: one JSON shape for every cloud command's output; a test that fails when a new list command breaks it.

Non-goals: changing the Dexto MCP, the `/v1` API or `@dexto/cloud-client`; changing input (flags, `--data` bodies); timestamp formats (filed separately); human-readable table output.

## Decisions

- **Keys are converted where JSON is printed, not where tool results are read.** The card suggests `queryWorkspaceTool` / `callWorkspaceTool`. Converting there would force every command that parses a tool result to switch its schema to snake_case at once, and would still leave `/v1` camelCase (model pricing) and CLI-built keys (`creditsUsd`, `htmlPath`, `nextCommand`) to fix one by one. One function, `jsonKeys`, used by `Output` and by the few writers that print JSON themselves, is the one place: whatever a command prints comes out snake_case. The MCP keeps its camelCase.
- **Someone's data keeps its keys.** Converting a tool's JSON schema, its `arguments`, a site record's `data` or a header map would change values an agent has to send back as they are. `jsonKeys` leaves the value of these keys untouched: `_meta`, `arguments`, `input`, `input_schema`, `confirm_schema`, `output_schema`, `schema`, `metadata`, `headers`, `env`, `variables`, and `data` when it is an object (a record's data) rather than a list. The rule is written down in the spec, so an agent knows which keys can keep their case.
- **`Output.list` writes the envelope.** A page without paging gets `has_more: false, next_after: null`. A page's other keys pass through as sibling keys, except `next_cursor`, which is dropped. Commands that printed a list with `record` or `result` (loops, apps, applications, chat agents/computers/browser profiles, site records, docs search, cloud search, connections, import, share received) print with `list`.
- **Two lists in one result:** `import list` prints sessions as `data` and skills beside it as `skills`. `share received` prints shared items as `data` and pending invitations as `invitations`. Both are flat top-level facts beside the main list.
- **Malformed ids are checked before the call.** Run, Site and record ids are UUIDs, checked by `uuidArgument`. A chat is named by its id or by a link the server reads (a chat's or its Project's), checked by `chatArgument`. A Project is named by its id or link. Each throws `CommandFailure('invalid_input')`, so the JSON error code is `invalid_input` and the exit code is 2. Commands whose server already refuses a malformed id with `invalid_arguments` (AutoBots, notifications, loops, `/v1` agents and sandboxes) keep relying on it. A tool result with `isError` and status `invalid_input` or `invalid_arguments` now maps to `invalid_input` instead of `failed`.
- **The contract test is a vitest test, not part of `scripts/check-cli-audit.mjs`.** The audit runs the built binary with no way to inject a fake server. `json-contract.test.ts` runs every list command through `runCloud` against a fake runtime that answers each workspace tool and `/v1` path with camelCase fixtures. It checks the envelope and that no key outside the data fields above is camelCase. It also fails when a command whose last word is `list` has no fixture, so a new list command can't skip it.

## Risks / Trade-offs

- Breaking change for scripts that parse today's output. It ships as a major version with a full rename list in the release note.
- A camelCase key inside a tool's free-form result that isn't on the data list gets converted. That is the rule, and it is the same for every command.
- Converting every printed value costs one tree walk per print. Outputs are small, so this is negligible.
