---
sidebar_position: 4
---

# Building a Web App

Once you have an agent using a Dexto image, turning it into a web application is straightforward. This tutorial shows you how to create a complete web app with backend API and frontend UI.

## What You'll Learn

- Using `startDextoServer()` for instant API servers
- Building a simple chat frontend
- Complete web app in ~60 lines of backend + ~150 lines of frontend
- Production deployment patterns

## The Pattern

```typescript
import { createAgent } from '@dexto/image-local';
import { startDextoServer } from '@dexto/server';

// 1. Create agent with pre-configured harness
const agent = createAgent(config, './agents/default.yml');

// 2. Start server - that's it!
const { server, stop } = await startDextoServer(agent, {
  port: 3000,
  agentCard: { name: 'My Agent' }
});
```

**The harness provides the infrastructure, and you get a complete REST API with:**
- Message endpoints (sync + async streaming)
- Session management
- MCP server integration
- Agent card for A2A communication
- OpenAPI specification
- WebSocket/SSE support

## Step 1: Set Up Your Project

```bash
mkdir my-agent-app
cd my-agent-app
npm init -y
npm install @dexto/image-local @dexto/agent-management @dexto/server tsx
```

## Step 2: Create Agent Configuration

Create `agents/default.yml`:

```yaml
name: my-agent-app
llm:
  provider: openai
  model: gpt-4o-mini
  apiKey: $OPENAI_API_KEY

storage:
  blob:
    type: local
    storePath: ./blobs
  database:
    type: sqlite
    path: ./agent.db
```

## Step 3: Create the Server

Create `src/index.ts`:

```typescript
import { createAgent } from '@dexto/image-local';
import { loadAgentConfig } from '@dexto/agent-management';
import { startDextoServer } from '@dexto/server';

async function main() {
  // Load configuration
  const config = await loadAgentConfig('./agents/default.yml');

  // Create agent from image
  const agent = createAgent(config, './agents/default.yml');

  // Start server with web UI
  const { server, stop } = await startDextoServer(agent, {
    port: 3000,
    agentCard: {
      name: 'My Agent App',
      version: '1.0.0',
      description: 'A simple agent web application',
    },
    webRoot: './app',  // Serve static files from this folder
  });

  console.log('🚀 Server running at http://localhost:3000');

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...');
    await stop();
    process.exit(0);
  });
}

main().catch(console.error);
```

## Step 4: Create the Frontend

Create `app/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Agent App</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div class="container">
    <header>
      <h1>My Agent App</h1>
      <div class="status" id="status">Connecting...</div>
    </header>

    <div class="chat-container">
      <div id="messages" class="messages"></div>
    </div>

    <div class="input-container">
      <input
        type="text"
        id="messageInput"
        placeholder="Type your message..."
        autocomplete="off"
      />
      <button id="sendButton">Send</button>
    </div>
  </div>

  <script src="main.js"></script>
</body>
</html>
```

Create `app/style.css`:

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen,
    Ubuntu, Cantarell, sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

.container {
  width: 90%;
  max-width: 800px;
  height: 90vh;
  background: white;
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 20px;
  text-align: center;
}

header h1 {
  margin-bottom: 8px;
  font-size: 24px;
}

.status {
  font-size: 12px;
  opacity: 0.9;
}

.chat-container {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  background: #f8f9fa;
}

.messages {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.message {
  max-width: 80%;
  padding: 12px 16px;
  border-radius: 12px;
  line-height: 1.4;
  animation: fadeIn 0.3s;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.message.user {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  align-self: flex-end;
  margin-left: auto;
}

.message.agent {
  background: white;
  color: #333;
  align-self: flex-start;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.message.error {
  background: #fee;
  color: #c33;
  align-self: center;
  text-align: center;
}

.input-container {
  display: flex;
  padding: 20px;
  background: white;
  border-top: 1px solid #e0e0e0;
  gap: 12px;
}

#messageInput {
  flex: 1;
  padding: 12px 16px;
  border: 2px solid #e0e0e0;
  border-radius: 24px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}

#messageInput:focus {
  border-color: #667eea;
}

#sendButton {
  padding: 12px 32px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 24px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

#sendButton:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

#sendButton:active {
  transform: translateY(0);
}

#sendButton:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}
```

Create `app/main.js`:

```javascript
let sessionId = null;
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const statusDiv = document.getElementById('status');

// Initialize
async function init() {
  try {
    // Create session
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const data = await response.json();
    sessionId = data.session.id;

    statusDiv.textContent = 'Connected';
    statusDiv.style.color = '#4ade80';

    // Focus input
    messageInput.focus();
  } catch (error) {
    statusDiv.textContent = 'Connection failed';
    statusDiv.style.color = '#f87171';
    addMessage('Failed to connect to server. Please refresh.', 'error');
  }
}

// Add message to UI
function addMessage(text, sender) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${sender}`;
  messageDiv.textContent = text;
  messagesDiv.appendChild(messageDiv);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Send message
async function sendMessage() {
  const message = messageInput.value.trim();
  if (!message || !sessionId) return;

  // Disable input
  messageInput.disabled = true;
  sendButton.disabled = true;

  // Add user message
  addMessage(message, 'user');
  messageInput.value = '';

  try {
    // Send to API
    const response = await fetch('/api/message-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: message,
        sessionId,
      }),
    });

    const data = await response.json();

    if (data.response) {
      addMessage(data.response, 'agent');
    } else {
      addMessage('No response from agent', 'error');
    }
  } catch (error) {
    addMessage('Error sending message. Please try again.', 'error');
  } finally {
    // Re-enable input
    messageInput.disabled = false;
    sendButton.disabled = false;
    messageInput.focus();
  }
}

// Event listeners
sendButton.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendMessage();
});

// Initialize on load
init();
```

## Step 5: Run Your Web App

```bash
export OPENAI_API_KEY="sk-..."
npx tsx src/index.ts
```

Open `http://localhost:3000` in your browser!

## What You Get

### REST API Endpoints

Once running, you automatically have:

**Core Endpoints:**
- `GET /health` - Health check
- `GET /api/greeting` - Agent greeting/info
- `POST /api/message` - Send message (async, SSE streaming)
- `POST /api/message-sync` - Send message (synchronous)

**Session Management:**
- `POST /api/sessions` - Create session
- `GET /api/sessions/:id` - Get session
- `DELETE /api/sessions/:id` - Delete session
- `GET /api/sessions` - List sessions

**LLM Operations:**
- `POST /api/llm/switch` - Switch LLM provider/model
- `GET /api/llm/providers` - List available providers

**MCP Integration:**
- `GET /api/mcp/servers` - List MCP servers
- `POST /api/mcp/servers` - Add MCP server
- `DELETE /api/mcp/servers/:name` - Remove server
- `GET /api/mcp/tools` - List all tools

**Memory & Search:**
- `GET /api/memory/:sessionId` - Get conversation history
- `POST /api/search` - Search messages/sessions

**Special Routes:**
- `GET /.well-known/agent-card.json` - Agent card (A2A)
- `GET /openapi.json` - OpenAPI specification
- `GET /mcp` - MCP HTTP/SSE transport

The harness provides this complete API automatically. You can explore all endpoints at `http://localhost:3000/openapi.json`.

## Next Steps

- [Deployment Guide](/docs/guides/deployment) - Detailed deployment instructions
- [API Reference](/docs/api/overview) - Complete API documentation
- [Security Best Practices](/docs/guides/security) - Secure your application

## Key Takeaways

✅ The harness handles all infrastructure setup
✅ `startDextoServer()` exposes your agent as a complete REST API
✅ Simple frontend with vanilla JS
✅ Production-ready patterns
✅ Easy deployment to any platform
✅ Built-in SSE/WebSocket support
✅ Agent card for A2A communication
