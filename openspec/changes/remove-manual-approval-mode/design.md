# Design

## Context

Core reads `permissions.mode` in three places: `ToolApprovalPolicy` (whether a call is ready without asking), `ApprovalManager` (whether a request reaches the handler), and `ToolManager` (the advertised `approval` hint). Hosts read it to decide whether to install an approval handler. Filesystem tools return `false` from `needsApproval` for any path inside the configured roots, so writes there never ask.

## Decisions

- **One enum, one boundary mapping.** `PERMISSIONS_MODES = ['full-access', 'asks-you']`. The schema accepts the legacy strings and maps them through `LEGACY_PERMISSIONS_MODES`, so every downstream reader sees only the new values. `getDeprecatedPermissionsModeWarning(value)` is the single source of the warning text.
- **Where the warning prints.** `DextoAgent` logs it when constructed with a raw legacy value (library users). The CLI prints it once after merging config and flags, before validation, so both the YAML value and `--permissions-mode manual` are covered. Validation then maps the value, so later layers do not warn again.
- **Asks you asks before edits.** For `write` and `edit` operations inside the workspace, filesystem tools ask without a directory key (`needsApproval` returns `true`). Reads inside the workspace still do not ask. Full access settles these through the existing `full-access` branch, so it does not ask. Keyless requests are what the TUI's "accept edits" shortcut approves, so that shortcut keeps working; operations outside the workspace still ask with a directory key, which accept edits never settles. Execution still validates outside paths against approved directory keys, so a session-wide tool allowance from a workspace edit does not open paths outside it.
- **Labels.** `PERMISSIONS_MODE_LABELS` maps values to "Full access" / "Asks you" for TUI, WebUI and help text.

## Risks / Trade-offs

- More prompts in Asks you. This is the intended behavior; "Allow for session" keeps it to one prompt per directory.
- The `PermissionsMode` type narrows, which is a compile-time break for code comparing against `'manual'`. The minor changeset's upgrade note covers it.
