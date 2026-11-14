# Design

## Context

Core reads `permissions.mode` in three places: `ToolApprovalPolicy` (whether a call is ready without asking), `ApprovalManager` (whether a request reaches the handler), and `ToolManager` (the advertised `approval` hint). Hosts read it to decide whether to install an approval handler. Filesystem tools return `false` from `needsApproval` for any path inside the configured roots, so writes there never ask.

## Decisions

- **One enum, one boundary mapping.** `PERMISSIONS_MODES = ['full-access', 'asks-you']`. The schema accepts the legacy strings and maps them through `LEGACY_PERMISSIONS_MODES`, so every downstream reader sees only the new values. `getDeprecatedPermissionsModeWarning(value)` is the single source of the warning text.
- **Where the warning prints.** `DextoAgent` logs it when constructed with a raw legacy value (library users). The CLI prints it once after merging config and flags, before validation, so both the YAML value and `--permissions-mode manual` are covered. Validation then maps the value, so later layers do not warn again.
- **Asks you asks before edits.** For `write` and `edit` operations, filesystem tools return the directory approval key even for paths inside the workspace. Reads inside the workspace still do not ask. Full access settles these keys through the existing `full-access` branch, so it does not ask. A session approval for the directory covers later edits there. The TUI's "accept edits" shortcut settles write and edit keys for directories inside the workspace (the canonical working directory), so it keeps approving workspace edits; edits outside the workspace still ask.
- **Labels.** `PERMISSIONS_MODE_LABELS` maps values to "Full access" / "Asks you" for TUI, WebUI and help text.

## Risks / Trade-offs

- More prompts in Asks you. This is the intended behavior; "Allow for session" keeps it to one prompt per directory.
- The `PermissionsMode` type narrows, which is a compile-time break for code comparing against `'manual'`. The minor changeset's upgrade note covers it.
