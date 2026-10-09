## Why

The OSS CLI already runs one-off tasks, but automation must parse plain text and cannot consume incremental structured results. Recover the useful output contract from the unpushed August runtime refactor in a small release against current upstream.

## What Changes

- Add `dexto run --format text|json|jsonl`, retaining text as the default.
- Emit a versioned terminal result for success, empty responses, startup errors, and execution failures.
- Stream selected agent events as JSONL while keeping diagnostics on stderr.
- Preserve existing agent configuration, approval behavior, sessions, and Core APIs.

Non-goals: shared lifecycle extraction, permission-policy changes, timeouts, remote execution, TUI redesign, Cloud SDK integration, and server distribution. Each is a later independently releasable slice.

## Capabilities

### New Capabilities

- `structured-task-output`: Stable machine-readable output for local headless tasks.

### Modified Capabilities

None.

## Impact

Only CLI command registration and headless output change. No dependency or exported Core contract changes; Cloud consumers continue using the same published construction APIs. Existing text-mode consumers retain their output and exit behavior.
