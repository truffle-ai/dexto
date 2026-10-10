## Context

`registerClient()` permits replacement by name. Existing calls can capture the original client, so eager close would break that compatibility. The name registry alone is insufficient for ownership cleanup.

## Goals / Non-Goals

Goals: retain displaced identities, close all manager-owned identities at manager-wide cleanup, avoid duplicate close within one cleanup pass, continue after a rejection.

Non-goals: reject/coalesce overlapping connections, eager retirement, change registration/cache ordering, repair overlapping cache consistency, add terminal close semantics, cancel connection startup or own process signals.

## Decisions

Use one private identity-keyed retirement collection retaining the previous name for existing safe cleanup logging. Capture displaced clients at successful registry replacement, after collision validation. Build a deduplicated union of current and retired identities when disconnecting, and clear retirement alongside existing registries after cleanup. Retired clients remain usable until cleanup. Re-registering an existing identity does not create a second close in that pass.

The existing startup-drain work is integrated before final validation; retirement cleanup runs after that drain so completed overlapping startup replacements are included.

## Risks / Trade-offs

Displaced resources remain open until manager-wide cleanup, preserving captured calls at the cost of retained resources. Individual `removeClient()` and restart behavior remain scoped to the currently registered client. A rejected disconnect remains logged and does not prevent other attempts, matching the existing cleanup contract. External registration racing cleanup and cache consistency during overlapping startup remain outside this slice.

## Migration Plan

Additive internal ownership fix with no public signature changes. Ship as a Core patch.

## Open Questions

None.
