# Proposal

Tracking: [DEXTO-2791](https://linear.app/truffleai/issue/DEXTO-2791). Supersedes [DEXTO-2735](https://linear.app/truffleai/issue/DEXTO-2735).

## Why

Rahul: "remove manual approval mode from the dexto CLI and core; use the same permission model as the hosted app".

The hosted app offers two permission choices, **Full access** and **Asks you**. The dexto CLI and Core still use `auto-approve` and `manual`. Manual mode also stopped asking before file edits inside the workspace (DEXTO-2735), so it no longer matches what users expect from a mode that asks.

## What Changes

- Core `permissions.mode` takes `full-access` (Full access) or `asks-you` (Asks you). The default stays permissive: `full-access`.
- `auto-approve` maps to `full-access` and `manual` maps to `asks-you` for one release. Each old value prints a deprecation warning that names the new value. The next release rejects them.
- Asks you asks before file writes and edits inside the workspace, as well as before shell commands and paths outside the workspace. "Allow for session" covers further edits to the same directory.
- `--permissions-mode` takes `full-access|asks-you` (old values accepted with the same warning). `--auto-approve` and `--bypass-permissions` stay as aliases for Full access.
- TUI, WebUI agent editor, help text, tool descriptions and docs use "Full access" and "Asks you".

## Non-goals

- New permission tiers, per-tool policy changes, or mid-run mode switching.
- Changing the meaning of `toolPolicies.alwaysAllow`, session approvals or mandatory (always-ask) approvals.
- Removing the TUI's temporary "accept edits" and bypass shortcuts.

## Capabilities

### New Capabilities

- `permission-modes`: the two permission modes, legacy value mapping and what Asks you asks about.

### Modified Capabilities

- `cli-permission-policy` (cli-shared-permission-policy): `--permissions-mode` values change to `full-access|asks-you`.

## Impact

- Published `@dexto/core`: `PermissionsMode` output type changes to `'full-access' | 'asks-you'`. Input still accepts the old strings for one release. Code that compares `config.permissions.mode === 'manual'` must compare against `'asks-you'`. Minor release with an upgrade note.
- Asks you users get a prompt before in-workspace file edits that previously ran without asking.
- dexto-cloudflare: see the DEXTO-2791 PR description for the caller audit.
