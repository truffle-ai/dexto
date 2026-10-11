# Design

## Context

The raw Node bridge intercepts /mcp before invoking Hono. Existing server auth is a middleware-only environment snapshot, while HTTP MCP logging includes request bodies and errors.

## Goals / Non-Goals

Use the same authorization policy instance for both interfaces and respect explicit externally owned authentication. Do not change agent policy or repair the existing singleton SDK transport's broader request ownership in this slice.

## Decisions

Extract the current environment-based decision and required bearer validation in the existing auth module. Attach the configured policy to the application for the bridge to consume; external bare applications retain the default factory. Export the narrow auth module so independent hosts can reuse bearer validation without initializing an agent app.

Handle only the exact MCP pathname, authenticate before reading its body, forward supported methods, and return safe errors instead of logging raw payloads or leaving requests pending.

## Risks / Trade-offs

Protected MCP requests that previously bypassed authentication will now be rejected as intended. Bare key headers no longer count as Bearer credentials. Explicit disableAuth delegates protection to the embedding host, retaining the existing ownership contract.
