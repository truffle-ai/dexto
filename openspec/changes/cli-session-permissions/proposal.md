# Familiar session approvals

## Why

The TUI already remembers approvals but uses inconsistent labels and hides remembered action scopes from the tool browser. Users need familiar once/session/reject choices and a discoverable way to change modes and revoke grants.

## What Changes

- Show the exact remembered scope and logical-session lifetime in approval prompts.
- Add `/permissions` for modes and inspection/revocation of remembered tool and action grants.
- Reset UI approval modes on session changes and honor mandatory manual approvals.
- Prevent compound shell syntax from sharing a simple command grant.

## Impact

Core exposes existing session grants through validated agent methods. The TUI reuses current modes, stores and selectors. No execution time/step limits or Cloud authority changes. Headless policy changes are a separate follow-up within Slice 2.
