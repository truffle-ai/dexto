---
sidebar_position: 2
---

# WebSocket API

The WebSocket API offers real-time, bidirectional communication with Saiki. Use this for building highly interactive applications.

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
  "sessionId": "optional-session-id",
  "stream": true,
  "imageData": { "base64": "...", "mimeType": "image/jpeg" }
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

---

## Server → Client Events
Listen for these events from the server. All events follow the `{ "event": "EVENT_NAME", "data": { ... } }` structure.

| Event | Data Payload | Description |
| :--- | :--- | :--- |
| `thinking` | `{}` | The agent has received the prompt and started processing. |
| `chunk` | `{ "content": "..." }` | A part of the agent's response when `stream` is `true`. |
| `response` | `{ "content": "..." }` | The final, complete response from the agent. |
| `toolCall` | `{ "toolName", "serverId", "arguments" }` | Informs that the agent is about to execute a tool. |
| `toolResult` | `{ "toolName", "serverId", "result" }` | Provides the result from a tool's execution. |
| `error` | `{ "message": "..." }` | An error occurred during message processing. | 