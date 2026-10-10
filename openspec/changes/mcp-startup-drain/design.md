# Design

## Context

See proposal.md for the lifecycle race. Registered clients do not cover candidates still connecting, and registration precedes asynchronous tool, prompt and resource discovery. The existing per-name connecting counters describe status but cannot be awaited.

## Goals / Non-Goals

Complete orderly cleanup for connection and restart operations already pending at the teardown boundary. Preserve per-name status counters, original outcomes, and desired registrations. Do not introduce a permanent closed state, cancellation, new timeouts, or serialization of overlapping legacy connection attempts.

## Decisions

Track the promise for each complete connection/restart body in one manager-owned set. Remove it in `finally` on success or failure. `disconnectAll()` awaits an `allSettled` snapshot before taking the registered-client snapshot and performing its existing cleanup. This covers restart's old-client disconnection as well as new-client handshake, discovery and publication.

Draining preserves the original result instead of manufacturing an interruption error. Closing a transport during initialization would require a broader client lifecycle contract, particularly around authentication and transport retries. Callers must stop starting new connection/restart operations before teardown; the snapshot does not include later operations.

## Risks / Trade-offs

- Existing protocol requests or caller-owned authentication can remain pending: draining adds no deadline and provides no prompt cancellation guarantee.
- Independent refresh operations and notification callbacks are not tracked by this change; callers remain responsible for their wider runtime lifecycle.
- `disconnectAll()` can take longer when startup is pending: document the deliberate ordering and test real child-process cleanup.

## Migration Plan

No API or configuration migration is required. Hosts should quiesce connection/restart producers before awaiting teardown. Desired registrations remain available for later explicit reconnection. Direct `DextoMcpClient` behavior is unchanged.
