## Why

Grouped MCP startup ignores strict mode, loses upstream schemas and result metadata, and leaves connections running when the host closes or startup fails. A local aggregation host should preserve the upstream protocol while owning its acquired connections.

## What Changes

- Honor strict startup without modifying caller configuration; close acquired resources on failure.
- Preserve tool schemas, metadata, error results, resource metadata and prompt arguments through SDK protocol forwarding.
- Advertise a fixed startup snapshot with stable upstream bindings; reject ambiguous tool aliases and duplicate prompt names.
- Make explicit close and transport close release the aggregation host's connections once.

## Capabilities

### New Capabilities

- `mcp-aggregation-host`: Connection ownership and protocol fidelity for the grouped MCP host.

### Modified Capabilities

None.

## Impact

The CLI aggregation handler changes; its existing initializer signature and returned MCP server remain compatible. It reuses the Core manager and SDK clients without changing Core policy or hosted application consumers. No new dependency or deployment is required.

Non-goals: automatic approval policy, agent execution, live capability refresh, OAuth interaction, HTTP hosting, or execution limits. The connecting MCP client and upstream servers retain their own authorization responsibilities.
