---
sidebar_position: 10
sidebar_label: "Dynamic Changes"
---
# Runtime / Dynamic Configuration Changes

`AgentStateManager` allows safe, validated modifications to the running configuration.

## Example – per-session LLM override

```typescript
stateManager.updateLLM(
  { provider: 'openai', model: 'gpt-4o', maxInputTokens: 50_000 },
  'user-123'
);
```

Internally the manager:

1. Validates the patch against `LLMConfigSchema`.
2. Stores the override under `sessionOverrides`.
3. Emits `dexto:stateChanged` and `dexto:sessionOverrideSet` events.

## Example – add MCP server at runtime

```typescript
await stateManager.addMcpServer('git', {
  command: 'mcp-git',
  args: ['--repo', process.cwd()]
});
```

This triggers `dexto:mcpServerAdded`, after which `MCPManager` connects and refreshes its capability cache.