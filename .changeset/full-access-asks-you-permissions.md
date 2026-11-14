---
'@dexto/core': minor
'@dexto/agent-management': minor
'@dexto/tools-filesystem': minor
'@dexto/server': minor
'@dexto/tui': minor
'@dexto/webui': minor
'dexto': minor
---

Permissions now use the hosted app's two modes: **Full access** (`full-access`) and **Asks you** (`asks-you`). Manual approval mode is removed.

**Upgrade note: rename `permissions.mode` values.** `manual` becomes `asks-you` and `auto-approve` becomes `full-access`. The old values still work in this release: they map to the new mode and print a warning that names the new value. The next release rejects them.

```yaml
permissions:
    mode: asks-you # was: manual
    # mode: full-access  # was: auto-approve
```

```bash
dexto --permissions-mode asks-you      # was: --permissions-mode manual
dexto --permissions-mode full-access   # was: --permissions-mode auto-approve
```

`--auto-approve` and `--bypass-permissions` still select Full access.

Behavior changes:

- Asks you now asks before writing or editing files inside the workspace, not only before shell commands and paths outside it. "Allow for session" covers further edits in the same directory. Full access does not ask.
- `PermissionsMode` is now `'full-access' | 'asks-you'`. Code that compares `config.permissions.mode` with `'manual'` or `'auto-approve'` must compare with the new values. `PERMISSIONS_MODE_LABELS`, `resolvePermissionsMode()` and `getDeprecatedPermissionsModeWarning()` are exported from `@dexto/core`.
- The tool approval reason `auto-approve-mode` is renamed `full-access-mode`.
- The TUI footer and `/config` show "Full access" or "Asks you".
