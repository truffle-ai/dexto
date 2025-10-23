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

#### `dexto:mcpServerRestarted`

Fired when an MCP server is restarted.

```typescript
{
  serverName: string;
}
```

#### `dexto:mcpResourceUpdated`

Fired when an MCP server resource is updated.

```typescript
{
  serverName: string;
  resourceUri: string;
}
```

#### `dexto:mcpPromptsListChanged`

Fired when available prompts from MCP servers change.

```typescript
{
  serverName: string;
  prompts: string[];
}
```

#### `dexto:mcpToolsListChanged`

Fired when available tools from MCP servers change.

```typescript
{
  serverName: string;
  tools: string[];
}
```

#### `dexto:resourceCacheInvalidated`

Fired when resource cache is invalidated.

```typescript
{
  resourceUri?: string;
  serverName: string;
  action: 'updated' | 'server_connected' | 'server_removed' | 'blob_stored';
}
```

#### `dexto:sessionTitleUpdated`

Fired when a session title is updated.

```typescript
{
  sessionId: string;
  title: string;
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

### User Approval Events

Dexto's generalized approval system handles various types of user input requests, including tool confirmations and form-based input (elicitation).

#### `dexto:approvalRequest`

Fired when user approval or input is requested. This event supports multiple approval types through a discriminated union based on the `type` field.

```typescript
{
  approvalId: string;           // Unique identifier for this approval request
  type: string;                 // 'tool_confirmation' | 'elicitation' | 'custom'
  sessionId?: string;           // Optional session scope
  timeout?: number;             // Request timeout in milliseconds
  timestamp: Date;              // When the request was created
  metadata: Record<string, any>; // Type-specific approval data
}
```

**Approval Types:**

- **`tool_confirmation`**: Binary approval for tool execution
  - `metadata.toolName`: Name of the tool requiring confirmation
  - `metadata.args`: Tool arguments
  - `metadata.description`: Optional tool description

- **`elicitation`**: Schema-based form input (typically from MCP servers or ask_user tool)
  - `metadata.schema`: JSON Schema defining expected input structure
  - `metadata.prompt`: Prompt text to display to user
  - `metadata.serverName`: Name of requesting entity (MCP server or 'Dexto Agent')
  - `metadata.context`: Optional additional context

- **`custom`**: Extensible approval type for custom use cases
  - `metadata`: Custom structure defined by the consumer

#### `dexto:approvalResponse`

Fired when a user approval response is received from the UI layer.

```typescript
{
  approvalId: string;                               // Must match the request approvalId
  status: 'approved' | 'denied' | 'cancelled';     // Approval status
  sessionId?: string;                              // Session identifier (if scoped)
  data?: Record<string, any>;                      // Type-specific response data
}
```

**Response Data by Type:**

- **Tool confirmation**: `{ rememberChoice?: boolean }`
- **Elicitation**: `{ formData: Record<string, unknown> }`
- **Custom**: Defined by consumer

**Usage Notes:**

- Agent-initiated forms use `ask_user` tool → triggers elicitation request
- MCP server input requests trigger elicitation automatically
- Tool confirmations can be remembered per session via `rememberChoice`
- Approval requests timeout based on configuration (default: 2 minutes)
- Cancelled status indicates timeout or explicit cancellation

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
  reasoning?: string;  // Extended thinking output for reasoning models
  provider?: string;
  model?: string;
  router?: string;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;  // Additional tokens used for reasoning
    totalTokens?: number;
  };
  sessionId: string;
}
```

**Note:** The `reasoning` field contains extended thinking output for models that support reasoning (e.g., o1, o3-mini). This is separate from the main `content` response.

#### `llmservice:chunk`

Fired when a streaming response chunk is received.

```typescript
{
  type: 'text' | 'reasoning';  // Indicates whether chunk is reasoning or main response
  content: string;
  isComplete?: boolean;
  sessionId: string;
}
```

**Note:** The `type` field distinguishes between reasoning output (`reasoning`) and the main response text (`text`). For reasoning models, you'll receive reasoning chunks followed by text chunks.

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
  sanitized: SanitizedToolResult;
  rawResult?: unknown; // only present when DEXTO_DEBUG_TOOL_RESULT_RAW=true
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
  'dexto:approvalRequest': {
    approvalId: string;
    type: 'tool_confirmation' | 'elicitation' | 'custom';
    sessionId?: string;
    timeout?: number;
    timestamp: Date;
    metadata: Record<string, any>;
  };
  'dexto:approvalResponse': {
    approvalId: string;
    status: 'approved' | 'denied' | 'cancelled';
    sessionId?: string;
    data?: Record<string, any>;
  };
  // ... other events
}

interface SessionEventMap {
  'llmservice:thinking': { sessionId: string };
  'llmservice:response': { content: string; tokenCount?: number; model?: string; sessionId: string };
  'llmservice:chunk': { content: string; isComplete?: boolean; sessionId: string };
  'llmservice:toolCall': { toolName: string; args: Record<string, any>; callId?: string; sessionId: string };
  'llmservice:toolResult': {
    toolName: string;
    sanitized: SanitizedToolResult;
    rawResult?: unknown;
    callId?: string;
    success: boolean;
    sessionId: string;
  };
  'llmservice:error': { error: Error; context?: string; recoverable?: boolean; sessionId: string };
  // ... other events
}
``` 
