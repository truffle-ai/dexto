# Proposal

## Why

Standalone library hosts need to call an upstream MCP tool using the literal server/tool identity returned by discovery, without agent alias parsing or conversion of protocol tool errors into thrown exceptions.

## What Changes

- Add an opt-in `MCPManager.callToolDirect` request accepting an existing MCP descriptor identity, arguments and caller cancellation signal.
- Return a typed full MCP tool result, retaining tool error results, structured content and protocol metadata.
- Reuse existing connected SDK clients and name-owned saved restart configuration timeouts; preserve all legacy execution and configuration APIs.

## Capabilities

### New Capabilities

- `mcp-direct-call`: Literal identity protocol calls and caller-owned cancellation for standalone hosts.

### Modified Capabilities

None.

## Impact

Core MCP manager API, protocol integration tests and SDK documentation; a Core patch release. No dependency upgrade, new connection engine, automatic retry, agent execution policy or Cloud changes. Existing agent execution and downstream consumers retain their current contracts and defaults.
