# Proposal

## Why

Agents outside a sandbox need a network MCP endpoint for the tools running inside it. The existing standalone aggregation gateway supports stdio only.

## What Changes

- Add optional authenticated Streamable HTTP hosting for the existing aggregation gateway, retaining stdio defaults.
- Share one upstream manager and startup capability snapshot across independent downstream requests.
- Own listener, request cancellation, upstream connections and subprocess cleanup.
- Reuse the shared server bearer validator from the preceding HTTP authorization slice.

Scope is OSS MCP hosting. Agent services, inference hosting, account enrollment, daemon integration, OAuth issuance and dynamic capability updates are excluded.

## Capabilities

### New Capabilities

- `standalone-mcp-http-host`: Authenticated, agent-independent HTTP aggregation and connection ownership.

### Modified Capabilities

None.

## Impact

CLI aggregation, using the narrow `@dexto/server/hono/auth` entrypoint. No new package or dependency, Core public API change, agent permission behavior change, or hosted consumer repository changes. Existing Core consumers retain their imports and behavior. Explicit externally owned server authorization remains supported.
