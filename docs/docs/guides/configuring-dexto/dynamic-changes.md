---
sidebar_position: 13
sidebar_label: "Dynamic Changes"
---
# Runtime / Dynamic Configuration Changes

Configure and manage runtime changes to agent state through the AgentStateManager.

:::tip Complete Reference
For complete API documentation and event specifications, see **[agent.yml → Dynamic Changes](./agent-yml.md#dynamic-changes)**.
:::

## Overview

`AgentStateManager` allows safe, validated modifications to the running configuration without restarting your agent.

## Example – per-session LLM override

```typescript
stateManager.updateLLM(
  { provider: 'openai', model: 'gpt-5', maxInputTokens: 50_000 },
  'user-123'
);
```

Internally the manager:

1. Validates the patch against `LLMConfigSchema`.
2. Stores the override under `sessionOverrides`.
3. Emits `state:changed` and `session:override-set` events.

## Example – add MCP server at runtime

```typescript
await agent.addMcpServer('git', {
  command: 'mcp-git',
  args: ['--repo', process.cwd()]
});
```

This triggers `mcp:server-added`, after which `MCPManager` connects and refreshes its capability cache.

## See Also

- [agent.yml Reference → Dynamic Changes](./agent-yml.md#dynamic-changes) - Complete API documentation
- [System Prompt Configuration](./systemPrompt.md) - Static configuration
- [MCP Configuration](./mcpConfiguration.md) - MCP server setup