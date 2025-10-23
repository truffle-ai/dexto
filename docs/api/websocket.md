---
sidebar_position: 2
---

# WebSocket API

The WebSocket API offers real-time, bidirectional communication with Dexto. Use this for building highly interactive applications.

### Connection URL
<p class="api-endpoint-header"><code>ws://localhost:3000/</code></p>
<small>_The port may vary based on your server configuration._</small>

---

## Client → Server Messages
Send these messages to the server as JSON-formatted strings to control the agent.

### `message`
Instructs the agent to process a user prompt.
```json
{
  "type": "message",
  "content": "Your prompt here",
  "sessionId": "required-session-id",
  "stream": true,
  "imageData": { "base64": "...", "mimeType": "image/jpeg" },
  "fileData": { "base64": "...", "mimeType": "application/pdf", "filename": "doc.pdf" }
}
```

### `reset`
Resets the conversation history for a given session.
```json
{
  "type": "reset",
  "sessionId": "optional-session-id"
}
```

### `cancel`
Cancels the currently processing message for a session.
```json
{
  "type": "cancel",
  "sessionId": "required-session-id"
}
```

### `approvalResponse`
Responds to an approval request from the agent.
```json
{
  "type": "approvalResponse",
  "data": {
    "approvalId": "approval-id-from-request",
    "status": "approved" | "denied" | "cancelled",
    "sessionId": "optional-session-id",
    "data": {}
  }
}
```

---

## Server → Client Events
Listen for these events from the server. All events follow the `{ "event": "EVENT_NAME", "data": { ... } }` structure.

| Event | Data Payload | Description |
| :--- | :--- | :--- |
| `thinking` | `{ sessionId }` | The agent has received the prompt and started processing. |
| `chunk` | `{ type: 'text' \| 'reasoning', content, isComplete?, sessionId }` | A part of the agent's response when `stream` is `true`. `type` indicates whether this is regular text or reasoning output from extended thinking models. |
| `response` | `{ text, reasoning?, tokenUsage: { inputTokens?, outputTokens?, reasoningTokens?, totalTokens? }, model?, provider?, router?, sessionId }` | The final, complete response from the agent. `reasoning` field contains reasoning output for extended thinking models. |
| `toolCall` | `{ toolName, args, callId?, sessionId }` | Informs that the agent is about to execute a tool. |
| `toolResult` | `{ toolName, sanitized, rawResult?, callId?, success, sessionId }` | Provides the canonical tool result payload (and, when `DEXTO_DEBUG_TOOL_RESULT_RAW` is enabled, the raw result). |
| `conversationReset` | `{ sessionId }` | Conversation history cleared for session. |
| `mcpServerConnected` | `{ name, success, error? }` | MCP server connection result. |
| `availableToolsUpdated` | `{ tools, source }` | Available tools changed. |
| `approvalRequest` | `{ ... }` | Request for user approval or input (tool confirmations, elicitations, custom). |
| `mcpResourceUpdated` | `{ resourceUri?, serverName, action }` | Resource from MCP server updated |
| `mcpPromptsListChanged` | `{ serverName }` | Available prompts changed |
| `mcpToolsListChanged` | `{ serverName }` | Available tools changed |
| `sessionTitleUpdated` | `{ sessionId, title }` | Session title was updated |
| `resourceCacheInvalidated` | `{ resourceUri?, serverName, action }` | Resource cache invalidated |
| `error` | Polymorphic error object with `sessionId` | An error occurred during message processing. See [Error Payloads](#error-payloads) below. |

### Error Payloads

The `error` event returns different payload structures depending on the error type. All error payloads include a `sessionId` field.

#### DextoRuntimeError
Runtime errors (file operations, API failures, system errors):
```typescript
{
  code: string,           // Error code (e.g., 'file_not_found')
  message: string,        // Human-readable error message
  scope: string,          // Error scope (e.g., 'agent', 'system')
  type: string,           // Error type (e.g., 'user', 'system')
  context?: object,       // Additional error context
  recovery?: object,      // Recovery suggestions
  traceId: string,        // Trace ID for debugging
  sessionId: string       // Session identifier
}
```

#### DextoValidationError
Validation errors (schema failures, input validation):
```typescript
{
  name: string,           // Error class name
  message: string,        // Summary error message
  issues: Issue[],        // Array of validation issues
  traceId: string,        // Trace ID for debugging
  errorCount: number,     // Number of blocking errors
  warningCount: number,   // Number of warnings
  sessionId: string       // Session identifier
}
```

#### Generic Errors
Unexpected errors not matching the above types:
```typescript
{
  code: 'internal_error', // Generic error code
  message: string,        // Error message
  scope: string,          // Error scope
  type: string,           // Error type
  severity: 'error',      // Severity level
  sessionId: string       // Session identifier
}
```
