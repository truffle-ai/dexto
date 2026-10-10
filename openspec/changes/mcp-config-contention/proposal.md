# Proposal

## Why

Concurrent one-shot MCP configuration edits read the same YAML snapshot and replace the whole file. Both commands can report success even though the later commit silently discards the other's edit. Atomic file replacement prevents torn writes but does not protect this read/mutate/write ownership.

## What Changes

- Give cooperating CLI add/remove commands exclusive configuration-edit ownership before reading YAML until commit and lock release.
- Return safe `config_busy` JSON and exit 2 immediately when another edit owns the same file.
- Release only locks acquired by the command, including rejected edits and write failures; report cleanup failures honestly.
- Document manual recovery after abrupt termination without PID/age-based automatic reclamation.

## Capabilities

### New Capabilities

- `mcp-config-edit-ownership`: contention outcomes and lifetime of one-shot MCP configuration edits.

### Modified Capabilities

None.

## Impact

CLI configuration editing, real competing-process regressions, documentation and a CLI patch changeset. Read-only commands, Core APIs and runtime, dependencies, hosted consumers and permissions remain unchanged. This protects cooperating CLI writers only; arbitrary external-editor conflict detection and automatic stale-lock stealing are outside scope.
