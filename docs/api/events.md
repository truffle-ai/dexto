---
sidebar_position: 3
---

# Events Reference

Complete event system documentation for monitoring and integrating with Dexto agents.

## Overview

The Dexto SDK provides a comprehensive event system through two main event buses:
- **AgentEventBus**: Agent-level events that occur across the entire agent instance
- **SessionEventBus**: Session-specific events that occur within individual conversation sessions

## Agent-Level Events

These events are emitted by the `AgentEventBus` and provide insight into agent-wide operations.

### Conversation Events

#### `dexto:conversationReset`

Fired when a conversation history is reset for a session.

```typescript
{
  sessionId: string;
}
```


### MCP Server Events

#### `dexto:mcpServerConnected`

Fired when an MCP server connection attempt completes (success or failure).

```typescript
{
  name: string;
  success: boolean;
  error?: string;
}
```

#### `dexto:mcpServerAdded`

Fired when an MCP server is added to the runtime state.

```typescript
{
  serverName: string;
  config: McpServerConfig;
}
```

#### `dexto:mcpServerRemoved`

Fired when an MCP server is removed from the runtime state.

```typescript
{
  serverName: string;
}
```

#### `dexto:mcpServerUpdated`

Fired when an MCP server configuration is updated.

```typescript
{
  serverName: string;
  config: McpServerConfig;
}
```

#### `dexto:availableToolsUpdated`

Fired when the available tools list is updated.

```typescript
{
  tools: string[];
  source: 'mcp' | 'builtin';
}
```

### Validation Events

#### `dexto:inputValidationFailed`

Fired when input validation fails for an LLM request.

```typescript
{
  sessionId: string;
  issues: Issue[];
  provider: LLMProvider;
  model: string;
}
```


### Configuration Events

#### `dexto:llmSwitched`

Fired when the LLM configuration is changed.

```typescript
{
  newConfig: LLMConfig;
  router?: string;
  historyRetained?: boolean;
  sessionIds: string[];
}
```

#### `dexto:stateChanged`

Fired when agent runtime state changes.

```typescript
{
  field: string; // keyof AgentRuntimeState
  oldValue: any;
  newValue: any;
  sessionId?: string;
}
```

#### `dexto:stateExported`

Fired when agent state is exported as configuration.

```typescript
{
  config: AgentConfig;
  runtimeSettings: any;
}
```

#### `dexto:stateReset`

Fired when agent state is reset to baseline.

```typescript
{
  toConfig: AgentConfig;
}
```

### Session Override Events

#### `dexto:sessionOverrideSet`

Fired when session-specific configuration is set.

```typescript
{
  sessionId: string;
  override: SessionOverride;
}
```

#### `dexto:sessionOverrideCleared`

Fired when session-specific configuration is cleared.

```typescript
{
  sessionId: string;
}
```

### Tool Confirmation Events

#### `dexto:toolConfirmationRequest`

Fired when a tool execution requires confirmation.

```typescript
{
  toolName: string;
  args: Record<string, any>;
  description?: string;
  executionId: string;
  timestamp: Date;
  sessionId?: string;
}
```

#### `dexto:toolConfirmationResponse`

Fired when a confirmation response is received.

```typescript
{
  executionId: string;
  approved: boolean;
  rememberChoice?: boolean;
  sessionId?: string;
}
```

---

## Session-Level Events

These events are emitted by the `SessionEventBus` and provide insight into LLM service operations within sessions.

### LLM Processing Events

#### `llmservice:thinking`

Fired when the LLM service starts processing a request.

```typescript
{
  sessionId: string;
}
```

#### `llmservice:response`

Fired when the LLM service completes a response.

```typescript
{
  content: string;
  tokenCount?: number;
  model?: string;
  sessionId: string;
}
```

#### `llmservice:chunk`

Fired when a streaming response chunk is received.

```typescript
{
  content: string;
  isComplete?: boolean;
  sessionId: string;
}
```

#### `llmservice:error`

Fired when the LLM service encounters an error.

```typescript
{
  error: Error;
  context?: string;
  recoverable?: boolean;
  sessionId: string;
}
```

#### `llmservice:switched`

Fired when session LLM configuration is changed.

```typescript
{
  newConfig: LLMConfig;
  router?: string;
  historyRetained?: boolean;
  sessionId: string;
}
```

#### `llmservice:unsupportedInput`

Fired when the LLM service receives unsupported input.

```typescript
{
  errors: string[];
  provider: LLMProvider;
  model?: string;
  fileType?: string;
  details?: any;
  sessionId: string;
}
```

### Tool Execution Events

#### `llmservice:toolCall`

Fired when the LLM service requests a tool execution.

```typescript
{
  toolName: string;
  args: Record<string, any>;
  callId?: string;
  sessionId: string;
}
```

#### `llmservice:toolResult`

Fired when a tool execution completes.

```typescript
{
  toolName: string;
  result: any;
  callId?: string;
  success: boolean;
  sessionId: string;
}
```

---


---

## Event Data Types

### Core Types

```typescript
interface AgentEventMap {
  'dexto:conversationReset': { sessionId: string };
  'dexto:mcpServerConnected': { name: string; success: boolean; error?: string };
  'dexto:availableToolsUpdated': { tools: string[]; source: string };
  'dexto:llmSwitched': { newConfig: LLMConfig; router?: string; historyRetained?: boolean; sessionIds: string[] };
  // ... other events
}

interface SessionEventMap {
  'llmservice:thinking': { sessionId: string };
  'llmservice:response': { content: string; tokenCount?: number; model?: string; sessionId: string };
  'llmservice:chunk': { content: string; isComplete?: boolean; sessionId: string };
  'llmservice:toolCall': { toolName: string; args: Record<string, any>; callId?: string; sessionId: string };
  'llmservice:toolResult': { toolName: string; result: any; callId?: string; success: boolean; sessionId: string };
  'llmservice:error': { error: Error; context?: string; recoverable?: boolean; sessionId: string };
  // ... other events
}
``` 