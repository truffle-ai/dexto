# Proposal

## Why

Headless startup currently replaces configured manual permissions with auto-approval. Users need the same Core policy through TUI and headless interfaces, with clear outcomes when a requested approval cannot be collected.

## What Changes

- Honor configured permissions during headless startup; preserve the existing permissive Core default.
- Add global `--permissions-mode manual|auto-approve` and make the existing auto-approval aliases select the same configuration in both interfaces. Reject contradictory options.
- Report correlated approval-required records in headless output while letting the Core run recover and finish.
- Show the configured approval mode in the TUI independently of interface shortcuts.

## Capabilities

### New Capabilities

- `cli-permission-policy`: Shared startup policy selection and noninteractive approval outcomes.

### Modified Capabilities

None; this repository has no durable specifications yet.

## Impact

CLI configuration, headless output and TUI presentation change. Explicit manual headless configurations now require approval instead of silently executing approval-sensitive operations. Published Core policy, defaults and shared server contracts remain unchanged. No hosted consumer changes or upgrade are needed. Mid-run runtime mode controls, edit/plan behavior, credential changes and task caps are outside this slice.
