---
sidebar_position: 5
---

# System

### Health Check
*A simple endpoint to check if the server is running. Returns `OK` with status 200.*

<p class="api-endpoint-header"><span class="api-method get">GET</span><code>/health</code></p>

### Get Greeting
*Retrieves the greeting message for the current agent. Can be session-specific.*

<p class="api-endpoint-header"><span class="api-method get">GET</span><code>/api/greeting</code></p>

#### Query Parameters
- `sessionId` (string, optional): Session ID for session-specific greeting.

#### Responses

**Success (200)**
```json
{
  "greeting": "Hi! I'm your Dexto agent. How can I help you today?"
}
```

### Agent Card (A2A)
*Provides the Agent Card for Agent-to-Agent discovery.*

<p class="api-endpoint-header"><span class="api-method get">GET</span><code>/.well-known/agent.json</code></p>
