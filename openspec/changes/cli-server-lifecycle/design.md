## Context

The CLI initializes its HTTP app and agent before listen(), but returns from startHonoApiServer before the listening callback. initializeHonoApi also installs process listeners whose cleanup is not owned by the host. Cloud uses its own Core host and does not import this CLI path.

## Goals / Non-Goals

Goals: truthful readiness, bind-error rollback, idempotent local HTTP host stop, owned process-listener cleanup, and real local process verification.

Non-goals: shared Core/server/image changes, Cloud dependency upgrades, new CLI modes, task limits, packaging redesign, or consolidation of all host runtimes.

## Decisions

Keep lifecycle ownership in the existing CLI HTTP composition. Await the server listening/error boundary and expose stop on its returned host result. Stop closes the HTTP listener and its active connections, closes an owned MCP transport, stops owned agents (the current agent and any previous agent whose stop failed during a switch), and unregisters this host's process hooks. Attempt all resource cleanup even if one operation fails; repeated stop calls share one result.

Extend the existing graceful-shutdown utility to return listener disposal, preserving its callers and Ink Ctrl+C behavior. Attach it to the HTTP host's stop operation instead of stopping only the initial/current agent. Startup errors attempt cleanup of acquired host resources, including process listeners, and invoke agent stop while preserving the original error. Cleanup of partially initialized Core internals remains Core responsibility when agent stop rejects before startup completes. Do not move this behavior into Core or introduce a wrapper package.

Test the host boundary with a real Node HTTP listener and targeted failure injection. Independently exercise real CLI processes with temporary config/CWD, no provider credentials or model calls: health after readiness, occupied port exits nonzero without a success banner, SIGTERM exits cleanly and releases the port. Explicit process-test deadlines guard tests; they are not runtime agent task caps.

## Risks / Trade-offs

- Closing active HTTP connections interrupts SSE clients during shutdown -> intentional local-host teardown, covered by lifecycle tests.
- Agent switching changes the resource to stop -> retain ownership until each agent stops successfully, including a failed replacement or previous-agent stop; wait for an in-flight switch before final cleanup. This does not change existing failed-switch recovery behavior.
- Process-global listeners affect other hosts -> dispose only listeners this registration owns and test repeated registration/disposal.
- Shared-library regressions would affect Cloud -> keep the diff CLI-only; reassess candidate Cloud validation if that scope changes.

## Migration Plan

Publish as a CLI patch with compatible return fields plus stop. Existing callers can continue awaiting startup without calling stop directly. Roll back by reverting the CLI release. No Cloud migration is required.
