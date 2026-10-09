## Context

The CLI headless bootstrap forces auto-approve and disables elicitation. Core still delegates requests with autoApproval disallowed to a host handler, which is absent today.

## Goals / Non-Goals

Return an immediate actionable denial for headless interactive approval requests. Preserve ordinary automatic execution, recoverable tool failures, output formats, and run completion semantics. No shared runtime changes or new flags/task bounds.

## Decisions

Use a stateless typed async function in the existing CLI approval directory. Return DENIED/SYSTEM_DENIED and the request correlation envelope. Register only for headless-run before agent.start; noninteractive session/search commands retain their behavior. Let Core convert the decision into its existing model-visible tool error; do not change fatal run/exit-code handling.

## Risks / Trade-offs

An authored needsApproval flag alone does not require manual approval in auto mode. Tests must issue an explicit autoApproval disallowed request before a side effect. Real Core agent tests exercise this distinction without model calls; existing real CLI JSON/JSONL process fixtures verify bootstrap/output compatibility. Cloud has independent hosted approval wiring and does not consume this handler.

## Migration Plan

CLI patch release with existing response contracts. Revert the CLI change to roll back; no Cloud migration.
