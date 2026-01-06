---
sidebar_position: 3
---

# Events Reference

Complete event system documentation for monitoring and integrating with Dexto agents.

## Overview

The Dexto SDK provides a comprehensive event system through two main event buses:
- **AgentEventBus**: Agent-level events that occur across the entire agent instance
- **SessionEventBus**: Session-specific events that occur within individual conversation sessions

### Event Naming Convention

All events follow the `namespace:kebab-case` format:
- **LLM events**: `llm:thinking`, `llm:chunk`, `llm:response`, `llm:tool-call`
- **Session events**: `session:created`, `session:reset`, `session:title-updated`
- **MCP events**: `mcp:server-connected`, `mcp:resource-updated`
- **Approval events**: `approval:request`, `approval:response`
- **State events**: `state:changed`, `state:exported`
- **Tool events**: `tools:available-updated`

### Event Visibility Tiers

Events are organized into three tiers based on their intended audience:

#### **Tier 1: Streaming Events** (`STREAMING_EVENTS`)
Exposed via `DextoAgent.stream()` for real-time chat UIs. These are the most commonly used events for building interactive applications.

**LLM Events:** `llm:thinking`, `llm:chunk`, `llm:response`, `llm:tool-call`, `llm:tool-result`, `llm:error`, `llm:unsupported-input`

**Tool Events:** `tool:running`

**Context Events:** `context:compressed`, `context:pruned`

**Message Queue Events:** `message:queued`, `message:dequeued`

**Run Lifecycle Events:** `run:complete`

**Session Events:** `session:title-updated`

**Approval Events:** `approval:request`, `approval:response`

**Use cases:**
- Real-time chat interfaces
- Progress indicators
- Streaming responses
- Tool execution tracking
- User approval flows

#### **Tier 2: Integration Events** (`INTEGRATION_EVENTS`)
Exposed via webhooks, A2A subscriptions, and monitoring systems. Includes all streaming events plus lifecycle and state management events.

**Additional events:** `session:created`, `session:reset`, `mcp:server-connected`, `mcp:server-restarted`, `mcp:tools-list-changed`, `mcp:prompts-list-changed`, `tools:available-updated`, `llm:switched`, `state:changed`

**Use cases:**
- External system integrations
- Monitoring and observability
- Analytics and logging
- Multi-agent coordination (A2A)

#### **Tier 3: Internal Events**
Only available via direct `AgentEventBus` access for advanced use cases. These are implementation details that may change between versions.

**Examples:** `resource:cache-invalidated`, `state:exported`, `state:reset`, `mcp:server-added`, `mcp:server-removed`, `session:override-set`

---

## Agent-Level Events

These events are emitted by the `AgentEventBus` and provide insight into agent-wide operations.

### Session Events

#### `session:reset`

Fired when a conversation history is reset for a session.

```typescript
{
  sessionId: string;
}
```

#### `session:created`

Fired when a new session is created and should become active.

```typescript
{
  sessionId: string;
  switchTo: boolean; // Whether UI should switch to this session
}
```

#### `session:title-updated`

Fired when a session's human-friendly title is updated.

```typescript
{
  sessionId: string;
  title: string;
}
```

#### `session:override-set`

Fired when session-specific configuration is set.

```typescript
{
  sessionId: string;
  override: SessionOverride;
}
```

#### `session:override-cleared`

Fired when session-specific configuration is cleared.

```typescript
{
  sessionId: string;
}
```

### MCP Server Events

#### `mcp:server-connected`

Fired when an MCP server connection attempt completes (success or failure).

```typescript
{
  name: string;
  success: boolean;
  error?: string;
}
```

#### `mcp:server-added`

Fired when an MCP server is added to the runtime state.

```typescript
{
  serverName: string;
  config: McpServerConfig;
}
```

#### `mcp:server-removed`

Fired when an MCP server is removed from the runtime state.

```typescript
{
  serverName: string;
}
```

#### `mcp:server-updated`

Fired when an MCP server configuration is updated.

```typescript
{
  serverName: string;
  config: McpServerConfig;
}
```

#### `mcp:server-restarted`

Fired when an MCP server is restarted.

```typescript
{
  serverName: string;
}
```

#### `mcp:resource-updated`

Fired when an MCP server resource is updated.

```typescript
{
  serverName: string;
  resourceUri: string;
}
```

#### `mcp:prompts-list-changed`

Fired when available prompts from MCP servers change.

```typescript
{
  serverName: string;
  prompts: string[];
}
```

#### `mcp:tools-list-changed`

Fired when available tools from MCP servers change.

```typescript
{
  serverName: string;
  tools: string[];
}
```

#### `resource:cache-invalidated`

Fired when resource cache is invalidated.

```typescript
{
  resourceUri?: string;
  serverName: string;
  action: 'updated' | 'server_connected' | 'server_removed' | 'blob_stored';
}
```

#### `tools:available-updated`

Fired when the available tools list is updated.

```typescript
{
  tools: string[];
  source: 'mcp' | 'builtin';
}
```

### Configuration Events

#### `llm:switched`

Fired when the LLM configuration is changed.

```typescript
{
  newConfig: LLMConfig;
  historyRetained?: boolean;
  sessionIds: string[]; // Array of affected session IDs
}
```

#### `state:changed`

Fired when agent runtime state changes.

```typescript
{
  field: string; // keyof AgentRuntimeState
  oldValue: any;
  newValue: any;
  sessionId?: string;
}
```

#### `state:exported`

Fired when agent state is exported as configuration.

```typescript
{
  config: AgentConfig;
}
```

#### `state:reset`

Fired when agent state is reset to baseline.

```typescript
{
  toConfig: AgentConfig;
}
```

### User Approval Events

Dexto's generalized approval system handles various types of user input requests, including tool confirmations and form-based input (elicitation). These events are included in `STREAMING_EVENTS` and are available via `DextoAgent.stream()`.

:::tip Custom Approval Handlers
For direct `DextoAgent` usage without SSE streaming, you can implement a custom approval handler via `agent.setApprovalHandler()` to intercept approval requests programmatically.
:::

#### `approval:request`

Fired when user approval or input is requested. This event supports multiple approval types through a discriminated union based on the `type` field.

```typescript
{
  approvalId: string;           // Unique identifier for this approval request
  type: string;                 // 'tool_confirmation' | 'command_confirmation' | 'elicitation'
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

- **`command_confirmation`**: Binary approval for command execution (e.g., bash commands)
  - `metadata.command`: Command requiring confirmation
  - `metadata.args`: Command arguments

- **`elicitation`**: Schema-based form input (typically from MCP servers or ask_user tool)
  - `metadata.schema`: JSON Schema defining expected input structure
  - `metadata.prompt`: Prompt text to display to user
  - `metadata.serverName`: Name of requesting entity (MCP server or 'Dexto Agent')
  - `metadata.context`: Optional additional context

#### `approval:response`

Fired when a user approval response is received from the UI layer.

```typescript
{
  approvalId: string;                               // Must match the request approvalId
  status: 'approved' | 'denied' | 'cancelled';     // Approval status
  reason?: DenialReason;                           // Reason for denial/cancellation
  message?: string;                                // Optional user message
  sessionId?: string;                              // Session identifier (if scoped)
  data?: Record<string, any>;                      // Type-specific response data
}
```

**Response Data by Type:**

- **Tool confirmation**: `{ rememberChoice?: boolean }`
- **Command confirmation**: `{ rememberChoice?: boolean }`
- **Elicitation**: `{ formData: Record<string, unknown> }`

**Usage Notes:**

- Agent-initiated forms use `ask_user` tool → triggers elicitation request
- MCP server input requests trigger elicitation automatically
- Tool confirmations can be remembered per session via `rememberChoice`
- Approval requests timeout based on configuration (default: 2 minutes)
- Cancelled status indicates timeout or explicit cancellation

---

## Session-Level Events

These events are emitted by the `SessionEventBus` and provide insight into LLM service operations within sessions. They are automatically forwarded to the `AgentEventBus` with a `sessionId` property.

### LLM Processing Events

#### `llm:thinking`

Fired when the LLM service starts processing a request.

```typescript
{
  sessionId: string;
}
```

#### `llm:response`

Fired when the LLM service completes a response.

```typescript
{
  content: string;
  reasoning?: string;  // Extended thinking output for reasoning models
  provider?: string;
  model?: string;
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

#### `llm:chunk`

Fired when a streaming response chunk is received.

```typescript
{
  chunkType: 'text' | 'reasoning';  // Indicates whether chunk is reasoning or main response
  content: string;
  isComplete?: boolean;
  sessionId: string;
}
```

**Note:** The `chunkType` field distinguishes between reasoning output (`reasoning`) and the main response text (`text`). For reasoning models, you'll receive reasoning chunks followed by text chunks.

#### `llm:error`

Fired when the LLM service encounters an error.

```typescript
{
  error: Error;
  context?: string;
  recoverable?: boolean;
  sessionId: string;
}
```

#### `llm:switched`

Fired when session LLM configuration is changed.

```typescript
{
  newConfig: LLMConfig;
  historyRetained?: boolean;
  sessionIds: string[]; // Array of affected session IDs
}
```

#### `llm:unsupported-input`

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

#### `llm:tool-call`

Fired when the LLM service requests a tool execution.

```typescript
{
  toolName: string;
  args: Record<string, any>;
  callId?: string;
  sessionId: string;
}
```

#### `tool:running`

Fired when a tool actually starts executing (after approval if required). This allows UIs to distinguish between tools pending approval and tools actively running.

```typescript
{
  toolName: string;
  toolCallId: string;
  sessionId: string;
}
```

#### `llm:tool-result`

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

### Context Management Events

#### `context:compressed`

Fired when conversation context is compressed to stay within token limits.

```typescript
{
  originalTokens: number;      // Actual input tokens that triggered compression
  compressedTokens: number;    // Estimated tokens after compression
  originalMessages: number;
  compressedMessages: number;
  strategy: string;
  reason: 'overflow' | 'token_limit' | 'message_limit';
  sessionId: string;
}
```

#### `context:pruned`

Fired when old messages are pruned from context.

```typescript
{
  prunedCount: number;
  savedTokens: number;
  sessionId: string;
}
```

### Message Queue Events

These events track the message queue system, which allows users to queue additional messages while the agent is processing.

#### `message:queued`

Fired when a user message is queued during agent execution.

```typescript
{
  position: number;  // Position in the queue
  id: string;        // Unique message ID
  sessionId: string;
}
```

#### `message:dequeued`

Fired when queued messages are dequeued and injected into context.

```typescript
{
  count: number;                 // Number of messages dequeued
  ids: string[];                 // IDs of dequeued messages
  coalesced: boolean;            // Whether messages were combined
  content: ContentPart[];        // Combined content for UI display
  sessionId: string;
}
```

### Run Lifecycle Events

#### `run:complete`

Fired when an agent run completes, providing summary information about the execution.

```typescript
{
  finishReason: LLMFinishReason;  // How the run ended
  stepCount: number;              // Number of steps executed
  durationMs: number;             // Wall-clock duration in milliseconds
  error?: Error;                  // Error if finishReason === 'error'
  sessionId: string;
}
```

**Finish Reasons:**
- `stop` - Normal completion
- `tool-calls` - Stopped to execute tool calls (more steps coming)
- `length` - Hit token/length limit
- `content-filter` - Content filter violation
- `error` - Error occurred
- `cancelled` - User cancelled
- `max-steps` - Hit max steps limit

---

## Usage Examples

### Listening to Streaming Events

```typescript
import { DextoAgent } from '@dexto/core';

const agent = new DextoAgent(config);
await agent.start();

// Use the stream() API to get streaming events
for await (const event of await agent.stream('Hello!', 'session-1')) {
  switch (event.name) {
    case 'llm:thinking':
      console.log('Agent is thinking...');
      break;
    case 'llm:chunk':
      process.stdout.write(event.content);
      break;
    case 'llm:response':
      console.log('\nFull response:', event.content);
      console.log('Tokens used:', event.tokenUsage);
      break;
    case 'llm:tool-call':
      console.log(`Calling tool: ${event.toolName}`);
      break;
    case 'tool:running':
      console.log(`Tool ${event.toolName} is now running`);
      break;
    case 'run:complete':
      console.log(`Run completed: ${event.finishReason} (${event.stepCount} steps, ${event.durationMs}ms)`);
      break;
    case 'approval:request':
      console.log(`Approval needed: ${event.type}`);
      // Handle approval UI...
      break;
  }
}
```

### Listening to Integration Events

```typescript
import { DextoAgent, INTEGRATION_EVENTS } from '@dexto/core';

const agent = new DextoAgent(config);
await agent.start();

// Listen to all integration events via the event bus
INTEGRATION_EVENTS.forEach((eventName) => {
  agent.agentEventBus.on(eventName, (payload) => {
    console.log(`[${eventName}]`, payload);
    
    // Send to your monitoring/analytics system
    sendToMonitoring(eventName, payload);
  });
});
```

### Listening to Internal Events

```typescript
import { DextoAgent } from '@dexto/core';

const agent = new DextoAgent(config);
await agent.start();

// Listen to internal events for advanced debugging
agent.agentEventBus.on('resource:cache-invalidated', (payload) => {
  console.log('Cache invalidated:', payload);
});

agent.agentEventBus.on('state:exported', (payload) => {
  console.log('State exported:', payload.config);
});
```

