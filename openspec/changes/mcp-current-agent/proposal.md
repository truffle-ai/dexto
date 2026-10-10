## Why

The CLI HTTP host can switch agents, but its MCP chat callback and agent-card resource retain the initial agent. After a successful switch, MCP chat fails against a stopped agent and discovery describes the wrong agent.

## What Changes

- Allow switching hosts to provide current-agent and current-card getters to the existing MCP initializer.
- Resolve one agent at chat entry and retain that agent for ephemeral session execution and cleanup.
- Wire the CLI host's existing availability checks and active agent/card into MCP requests.
- Preserve static three-argument initialization and standalone card registration.

## Capabilities

### New Capabilities

- `mcp-agent-context`: MCP request routing and card discovery reflect the host's current available agent.

### Modified Capabilities

None.

## Impact

`@dexto/server` gains an additive initialization option; `dexto` supplies it for HTTP-host MCP. Core, dependencies and the standalone stdio host remain unchanged. Existing static server consumers retain their behavior. No hosted application source changes are needed.

Non-goals: changing permission policy, MCP transport identity during a connection, cancellation of running calls during agent switches, Core lifecycle cleanup, or new execution limits.
