# Tasks

## 1. Core modes

- [x] 1.1 Rename the mode enum to `full-access|asks-you`, map legacy values in the schema and export the deprecation warning; test each old value maps with a warning.
- [x] 1.2 Switch Core readers (approval policy, approval manager, tool manager, DextoAgent) to the new values.

## 2. Asks you asks before edits

- [x] 2.1 Filesystem write/edit tools ask (without a directory key) inside the workspace, so "accept edits" still settles them; test that Asks you prompts before a file edit and a shell command and Full access does not.

## 3. Interfaces

- [x] 3.1 CLI flag values, help, deprecation warning; regenerate the CLI audit.
- [x] 3.2 TUI and WebUI labels, agent YAMLs, docs.

## 4. Release

- [x] 4.1 Minor changeset with an upgrade note; full quality gate.
