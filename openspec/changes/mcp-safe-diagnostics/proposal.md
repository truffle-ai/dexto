## Why

MCP connection and capability diagnostics currently serialize configuration, operation payloads and provider failures. Those values can contain credentials or private application data even when only operational logs are intended.

## What Changes

- Keep MCP operation labels and selected server/tool identifiers in diagnostics.
- Omit stdio configuration, remote URLs, resource URIs, capability definitions, prompt/resource payloads, elicitation content and raw provider errors from Core MCP logs.
- Use fixed Core MCP error codes for failure classifications.
- Preserve existing caller results, errors, configuration inspection, events and approval behavior.
- Document the boundary between operational logs and raw caller-owned inspection APIs.

## Capabilities

### New Capabilities

- `mcp-diagnostics`: Operational MCP logging without raw configuration or operation payloads.

### Modified Capabilities

None.

## Impact

Limited to Core MCP client/manager logs, regression fixtures, documentation and a Core patch changeset. Public signatures, transports, authentication, permissions, naming, error wrapping and agent behavior remain unchanged.
