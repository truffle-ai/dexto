# Design

## Context

MCPManager owns clients, errors and successful restart configuration. Disabled or initially failed configurations are absent from the legacy config cache. Existing callers can overlap attempts for one name.

## Goals / Non-Goals

Provide opt-in desired configuration ownership and safe status observation. Preserve the existing engine and legacy APIs. No terminal close, daemon, liveness monitoring or automatic configuration application.

## Decisions

- `configureServer(name, config)` copies validated desired configuration; `connectConfiguredServer(name)` delegates existing connection behavior; `forgetServerConfiguration(name)` releases desired configuration.
- `getConfiguredServerStatuses()` includes only explicit registrations. `configuredTransport` describes desired configuration, never the transport of a client connected through a legacy call.
- Configure/forget reject while a registered client or an in-flight operation exists. Unknown, disabled or active configured connections reject without spawning. Desired configuration survives removeClient and reusable disconnectAll; forgetting is explicit.
- Status precedence is connecting, connected, disabled, failed, configured. Connected means registered, not a liveness guarantee. Count in-flight operations per name through finally; preserve existing overlapping attempt behavior.
- Derive status from owned configuration and existing client/error state. Return fresh readonly discriminated values with failed-only allowlisted error codes; never return configurations, raw errors, client/process metadata or credentials.

## Risks / Trade-offs

Legacy calls may connect a different configuration for an explicitly configured name; configuredTransport remains desired metadata. Legacy raw error getters remain unchanged. Shutdown racing an existing connect is not redesigned in this slice.
