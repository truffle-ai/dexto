# Proposal

## Why

The Node HTTP bridge handles MCP before Hono routing, so protected servers currently admit unauthorized MCP requests. The same transport logs raw protocol payloads.

## What Changes

- Reuse one HTTP authorization decision for protected API and MCP requests.
- Match the exact MCP endpoint and support its transport methods.
- Retain development defaults and explicit external authentication ownership.
- Omit raw protocol payloads and terminate failed HTTP transport requests safely.

Scope is the existing OSS HTTP transport boundary. Session ownership, agent permissions, gateway hosting and hosted consumer changes are excluded.

## Capabilities

### New Capabilities

- `http-mcp-authorization`: Existing server authentication applies consistently to its MCP transport.

### Modified Capabilities

None.

## Impact

`@dexto/server` authentication and Node adapters. Add a narrow shared authentication entrypoint for host reuse. Core public imports and behavior remain unchanged; no hosted consumer repository changes are needed. Clients must use the documented Bearer scheme rather than a bare key.
