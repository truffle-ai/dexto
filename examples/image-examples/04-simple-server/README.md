# Example 04: Simple Dexto Webapp

This example demonstrates how to build a complete webapp with Dexto: backend API + frontend UI. It shows the pattern: **import image → create agent → start server → serve UI**.

## What This Example Shows

- ✅ How to use `startDextoServer()` to spin up a full API server
- ✅ Simple chat frontend (HTML/CSS/JS) that connects to the API
- ✅ Complete webapp in ~50 lines of backend code + ~150 lines of frontend
- ✅ Production-ready pattern for building Dexto webapps

## Quick Start

### Prerequisites

1. **Build the base image** (Example 00):
   ```bash
   cd ../00-building-image
   npm install
   npm run build
   cd ../04-simple-server
   ```

2. **Set your OpenAI API key**:
   ```bash
   export OPENAI_API_KEY=sk-...
   ```

### Run the Server

```bash
npm install
npm start
```

The server will start at `http://localhost:3000` with the web UI and all API endpoints ready!

### Using the Web UI

Once the server is running, open your browser:

```
http://localhost:3000
```

You'll see a simple chat interface where you can:
- Send messages to the agent
- See real-time responses
- View your conversation history

The UI automatically creates a session and handles all API communication for you!

## What's Included

### Web UI (`app/`)

A simple, clean chat interface built with vanilla HTML/CSS/JavaScript:
- **`app/index.html`** - Chat UI structure
- **`app/style.css`** - Modern, gradient-based styling
- **`app/main.js`** - API communication and chat logic

Features:
- Auto-creates session on page load
- Real-time message sending and receiving
- Error handling and loading states
- Responsive design

### API Endpoints

Once running, you have access to:

- **`/health`** - Health check endpoint
- **`/api/greeting`** - Get agent greeting/info
- **`/api/message`** - Send messages (async with SSE streaming)
- **`/api/message-sync`** - Send messages (synchronous)
- **`/api/llm/switch`** - Switch LLM provider/model
- **`/api/sessions/*`** - Session management
- **`/api/mcp/*`** - MCP server management
- **`/api/webhooks/*`** - Webhook subscriptions
- **`/api/prompts/*`** - Prompt management
- **`/api/resources/*`** - Resource access
- **`/api/memory/*`** - Memory management
- **`/api/agents/*`** - Multi-agent switching
- **`/api/approvals/*`** - Approval management
- **`/api/queue/*`** - Message queue
- **`/api/search`** - Search messages/sessions

### Special Routes

- **`/.well-known/agent-card.json`** - Agent card for Agent-to-Agent (A2A) communication
- **`/openapi.json`** - Full OpenAPI specification
- **`/mcp`** - MCP HTTP/SSE transport endpoint

## Try It Out

### 1. Check Health

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### 2. Create a Session

First, create a session to track the conversation:

```bash
curl -X POST http://localhost:3000/api/sessions \
  -H "Content-Type: application/json" \
  -d '{}'
```

Expected response:
```json
{
  "session": {
    "id": "sess_abc123...",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "lastActivityAt": "2024-01-01T00:00:00.000Z"
  }
}
```

Save the `id` from the response - you'll need it for sending messages.

### 3. Send a Message

Now send a message using the sessionId (replace `sess_abc123...` with your actual session ID):

```bash
curl -X POST http://localhost:3000/api/message-sync \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Hello! Can you count the words in this sentence?",
    "sessionId": "sess_abc123..."
  }'
```

Expected response:
```json
{
  "response": "I'll count the words for you...",
  "sessionId": "sess_abc123...",
  "tokenUsage": { "inputTokens": 50, "outputTokens": 20 },
  "model": "gpt-4o-mini",
  "provider": "openai"
}
```

### 4. View Agent Card

```bash
curl http://localhost:3000/.well-known/agent-card.json
```

Expected response:
```json
{
  "name": "Example Server Agent",
  "version": "1.0.0",
  "description": "A simple example showing how to start a Dexto server",
  "apiUrl": "http://localhost:3000",
  "capabilities": ["streaming", "tools", "memory"]
}
```

### 5. View OpenAPI Spec

```bash
curl http://localhost:3000/openapi.json
```

This returns the complete OpenAPI 3.0 specification for the API.

## The Code

The entire server setup is remarkably simple:

```typescript
import { createAgent } from '../../00-building-image/dist/index.js';
import { loadAgentConfig } from '@dexto/agent-management';
import { startDextoServer } from '@dexto/server';

async function main() {
    // 1. Load config
    const config = await loadAgentConfig('./agents/default.yml');

    // 2. Create agent from image
    const agent = createAgent(config, './agents/default.yml');

    // 3. Start server - that's it!
    const { server, stop } = await startDextoServer(agent, {
        port: 3000,
        agentCard: {
            name: 'Example Server Agent',
            description: 'A simple example server',
        },
    });

    console.log('Server running at http://localhost:3000');

    // Handle shutdown
    process.on('SIGINT', async () => {
        await stop();
        process.exit(0);
    });
}

main();
```

## What startDextoServer() Does

The `startDextoServer()` helper handles all the infrastructure:

1. **Creates event subscribers** - WebhookEventSubscriber, A2ASseEventSubscriber
2. **Creates approval coordinator** - For tool confirmation and elicitation
3. **Creates Hono app** - Full REST API with all routes
4. **Creates Node.js HTTP server** - With proper streaming support
5. **Wires everything together** - Registers subscribers, sets approval handlers
6. **Starts the agent** - Calls `agent.start()` with proper initialization
7. **Returns control** - Provides `server` and `stop()` for your use

## Options

You can customize the server with various options:

```typescript
const { server, stop } = await startDextoServer(agent, {
    port: 3000,                    // Port to listen on (default: 3000 or process.env.PORT)
    hostname: '0.0.0.0',           // Hostname to bind (default: 0.0.0.0)
    baseUrl: 'https://my.app',     // Base URL for agent card (default: http://localhost:{port})
    agentCard: {                   // Override agent card metadata
        name: 'My Agent',
        version: '2.0.0',
        description: 'Custom description',
    },
    webRoot: '/path/to/webui',     // Serve static WebUI files (optional)
    webUIConfig: {                 // WebUI runtime config (optional)
        analytics: { /* ... */ }
    }
});
```

## Advanced: Serving a WebUI

You can serve a web frontend alongside the API:

```typescript
const { server, stop } = await startDextoServer(agent, {
    port: 3000,
    webRoot: '/path/to/webui/dist',  // Absolute path to built WebUI
    webUIConfig: {
        analytics: {
            enabled: true,
            provider: 'plausible'
        }
    }
});
```

This will:
- Serve static files from `webRoot`
- Inject `webUIConfig` into the index.html for runtime configuration
- Provide SPA fallback routing (unmatched routes → index.html)

## File Structure

```
04-simple-server/
├── app/                   # Frontend web UI
│   ├── index.html         # Chat interface structure
│   ├── style.css          # Modern, clean styling
│   └── main.js            # API communication logic
├── src/
│   └── index.ts           # Main server entry point (~60 lines)
├── agents/
│   └── default.yml        # Agent configuration
├── package.json           # Dependencies: @dexto/server, @dexto/agent-management
├── tsconfig.json          # TypeScript config
└── README.md              # This file
```

## Dependencies

This example uses:

- **`@dexto/server`** - Server infrastructure, Hono app, REST API
- **`@dexto/agent-management`** - Config loading and agent management
- **Base image** (from Example 00) - Pre-bundled providers and tools

## Comparison: Before vs After

### Before (Manual Setup - ~100 lines)

```typescript
// Create event subscribers
const webhookSubscriber = new WebhookEventSubscriber();
const sseSubscriber = new A2ASseEventSubscriber();
const approvalCoordinator = new ApprovalCoordinator();

// Create Hono app
const app = createDextoApp({
    getAgent: () => agent,
    getAgentCard: () => agentCard,
    approvalCoordinator,
    webhookSubscriber,
    sseSubscriber
});

// Create Node server
const { server, webhookSubscriber: ws } = createNodeServer(app, {
    getAgent: () => agent,
    port: 3000,
    hostname: '0.0.0.0'
});

// Wire everything together
if (ws) agent.registerSubscriber(ws);
webhookSubscriber.subscribe(agent.agentEventBus);
sseSubscriber.subscribe(agent.agentEventBus);

// Set approval handler
if (needsHandler) {
    const handler = createManualApprovalHandler(approvalCoordinator);
    agent.setApprovalHandler(handler);
}

// Start agent
await agent.start();

// Listen
server.listen(3000);
```

### After (With startDextoServer - ~5 lines)

```typescript
const { server, stop } = await startDextoServer(agent, {
    port: 3000,
    agentCard: { name: 'My Agent' }
});
```

## Next Steps

- **Add WebUI**: Try serving a web frontend using the `webRoot` option
- **Customize middleware**: For advanced use cases, use the lower-level APIs directly
- **Deploy**: This pattern works great for Docker, Railway, Vercel, etc.

## Key Takeaways

✅ **One function call** - `startDextoServer()` handles all infrastructure
✅ **Complete webapp** - Backend + Frontend in one example
✅ **Production-ready** - Full REST API with streaming, SSE, webhooks
✅ **Clean pattern** - Import image → create agent → start server → serve UI
✅ **Simple frontend** - Vanilla HTML/CSS/JS, no framework needed
✅ **No boilerplate** - ~60 lines backend + ~150 lines frontend

This is how you build web applications with Dexto! 🎉
