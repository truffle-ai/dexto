## Why

`dexto acp` reports every tool result as plain text and guesses the tool kind from its name. So ACP clients like T3 Code and Zed can't show an edit as a diff. They also can't tell a file read from a shell command, or show what an approval will change before the person allows it.

## What Changes

- Tool kinds come from Dexto's tool activity category: file reads are `read`, file writes and edits are `edit`, searches are `search`, web and HTTP are `fetch`, and commands and processes are `execute`. Every other tool is `other`.
- A file change becomes ACP `diff` content, one diff per hunk, at the file's absolute path. This applies both to the result and to the permission request's preview.
- A finished shell command is shown as the command, its output and its exit code.

Part 2 of DEXTO-2849; it builds on `cli-acp-server`.

## Capabilities

### Modified Capabilities

- `acp-server`: tool calls carry kinds from activity categories, plus diff and shell content.

## Impact

`packages/cli/src/cli/commands/acp` only. Adds the `diff` package to the CLI.
