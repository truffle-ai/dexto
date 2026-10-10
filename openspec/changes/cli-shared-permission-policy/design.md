# Design

## Context

TUI and run already construct DextoAgent with the shared CLI overrides, but noninteractive bootstrap replaces permissions afterward. Core owns allow rules, mandatory approvals and execution. Approval events are emitted by interface handlers.

## Goals / Non-Goals

Select startup permissions consistently and expose unavailable approval without replacing the Core loop. Mid-run mode switching and edit/plan controls remain a subsequent shared-runtime slice.

## Decisions

- Resolve `--permissions-mode` and existing aliases in applyCLIOverrides. No interface-specific policy flag. Reject manual plus an auto alias instead of choosing implicitly.
- Remove the noninteractive permission override. Keep current elicitation and output transport handling separate.
- Emit request/response events from the headless denial adapter, then project unavailable approval requests into correlated output records. The single headless run attributes legacy unscoped events to its known session, while the original denied response retains its original envelope and grants no authority. Continue streaming so the model can recover; a completed run can include approval-required records.
- Display configured permissions in TUI alongside temporary session shortcuts. Core owns the default and enforcement.

## Risks / Trade-offs

Explicit manual headless configurations change behavior → document the correction and global auto override. An approval-required record proves that action was not authorized; it does not mean the entire task cannot recover. No Core API or default changes are included, preserving hosted compatibility.
