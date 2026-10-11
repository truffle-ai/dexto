# Design

## Context

The existing CLI aggregation initializer owns one manager and one downstream transport. The Node server currently intercepts HTTP MCP before its Hono authentication middleware. See proposal.md for scope.

## Goals / Non-Goals

Reuse the existing manager, aliases, discovery and request forwarding. Keep Node networking in host adapters and preserve the stdio initializer contract. No inference service, agent loop, enrollment, new permission engine or dynamic capability reload is introduced.

## Decisions

Split aggregation ownership from downstream attachment: one host initializes upstreams and freezes discovered capabilities, while downstream servers attach to the same snapshot. The existing stdio entrypoint retains ownership-coupled cleanup.

Use stateless Streamable HTTP with a fresh SDK server and transport for each request. This avoids a session registry and prevents client teardown from closing shared upstreams. Authenticate before body parsing; bind literal loopback open by default, enforce an environment-provided key when supplied, and require a key for other addresses unless the operator explicitly selects --no-auth. This permits externally owned ingress authentication while avoiding accidental unauthenticated network exposure. GET/DELETE do not provide notification streams or persistent session management.

Register response completion/disconnect cleanup before protocol handling. Closing a downstream server aborts its forwarded request signal. Host shutdown stops admission and closes downstream owners, listener and upstream connections. Failed startup rolls back everything already acquired.

Extract the existing server authentication decision for its raw MCP bridge, using the same configured policy instance and respecting externally owned authentication. Remove payload logging. Core imports and runtime behavior remain unchanged.

## Risks / Trade-offs

- Static capabilities can become stale when an upstream changes: restart the gateway to rediscover.
- A bearer key authorizes the whole exposed tool catalog: the operator selects trusted callers and configured servers. This does not enforce agent approval policy.
- HTTP alone provides no encryption: remote deployment must supply HTTPS or a trusted private transport.
- An upstream may not honor cancellation: propagate signals and close owned processes at host shutdown, without claiming rollback of effects.

## Migration Plan

Keep existing stdio commands as defaults. Add opt-in HTTP flags and documentation, validate protocol compatibility and lifecycle with actual local upstream processes, and run the full OSS quality gate. No hosted consumer upgrade is required.
