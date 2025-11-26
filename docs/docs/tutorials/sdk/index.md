---
sidebar_position: 1
title: "Dexto Agent SDK"
---

# Building with the Dexto Agent SDK

Build AI agents programmatically with TypeScript. Full control over agent behavior, sessions, and integration.

## Installation

```bash
npm install @dexto/core
```

## Quick Start

```typescript
import { DextoAgent } from '@dexto/core';

// Create an agent
const agent = new DextoAgent({
  llm: {
    provider: 'openai',
    model: 'gpt-5-mini',
    apiKey: process.env.OPENAI_API_KEY
  }
});

// Start the agent
await agent.start();

// Create a session for the conversation
const session = await agent.createSession();

// Generate a response
const response = await agent.generate('What is TypeScript?', {
  sessionId: session.id
});
console.log(response.content);

// Clean up
await agent.stop();
```

## Core Concepts

### Agent Lifecycle

```typescript
// 1. Create
const agent = new DextoAgent(config);

// 2. Start (initializes services)
await agent.start();

// 3. Use
const session = await agent.createSession();
const response = await agent.generate(message, { sessionId: session.id });

// 4. Stop (cleanup)
await agent.stop();
```

### Sessions

Sessions maintain conversation context. Each session has isolated history.

```typescript
// Create sessions for different users/contexts
const userSession = await agent.createSession('user-123');
const adminSession = await agent.createSession('admin-456');

// Each session maintains separate history
await agent.generate('Hello', { sessionId: userSession.id });
await agent.generate('Show admin panel', { sessionId: adminSession.id });

// Manage sessions
const sessions = await agent.listSessions();
const history = await agent.getSessionHistory('user-123');
await agent.resetConversation('user-123');
await agent.deleteSession('user-123');
```

### Methods: generate() vs stream() vs run()

```typescript
// generate() - Wait for complete response (recommended)
const response = await agent.generate('Hello', { sessionId });
console.log(response.content);
console.log(response.usage.totalTokens);

// stream() - Real-time streaming for UIs
for await (const event of await agent.stream('Hello', { sessionId })) {
  if (event.type === 'llm:chunk') {
    process.stdout.write(event.content);
  }
}

// run() - Lower-level, returns just the text
const text = await agent.run('Hello', undefined, undefined, sessionId);
```

## Adding MCP Tools

```typescript
const agent = new DextoAgent({
  llm: {
    provider: 'openai',
    model: 'gpt-5-mini',
    apiKey: process.env.OPENAI_API_KEY
  },
  mcpServers: {
    filesystem: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '.']
    }
  }
});
```

### Dynamic Tool Management

```typescript
// Add server at runtime
await agent.connectMcpServer('web_search', {
  type: 'stdio',
  command: 'npx',
  args: ['-y', 'tavily-mcp@0.1.3'],
  env: { TAVILY_API_KEY: process.env.TAVILY_API_KEY }
});

// List available tools
const tools = await agent.getAllTools();
console.log(Object.keys(tools));

// Remove server
await agent.removeMcpServer('web_search');
```

## Real-time Events

Listen to agent events for UIs and monitoring:

```typescript
// LLM events
agent.agentEventBus.on('llm:thinking', ({ sessionId }) => {
  console.log('Thinking...');
});

agent.agentEventBus.on('llm:chunk', ({ content, sessionId }) => {
  process.stdout.write(content);
});

agent.agentEventBus.on('llm:tool-call', ({ toolName, args, sessionId }) => {
  console.log(`Using tool: ${toolName}`);
});

agent.agentEventBus.on('llm:response', ({ content, usage, sessionId }) => {
  console.log(`Response complete. Tokens: ${usage?.totalTokens}`);
});

// MCP events
agent.agentEventBus.on('mcp:server-connected', ({ name, success }) => {
  console.log(`Server ${name}: ${success ? 'connected' : 'failed'}`);
});
```

## Common Patterns

### Multi-User Chat Application

```typescript
class ChatApp {
  private agent: DextoAgent;
  private sessions = new Map<string, string>();

  async initialize() {
    this.agent = new DextoAgent(config);
    await this.agent.start();
  }

  async handleMessage(userId: string, message: string) {
    // Get or create session for user
    let sessionId = this.sessions.get(userId);
    if (!sessionId) {
      const session = await this.agent.createSession(`user-${userId}`);
      sessionId = session.id;
      this.sessions.set(userId, sessionId);
    }

    // Generate response
    const response = await this.agent.generate(message, { sessionId });
    return response.content;
  }
}
```

### Express API Server

```typescript
import express from 'express';
import { DextoAgent } from '@dexto/core';

const app = express();
app.use(express.json());

const agent = new DextoAgent(config);
await agent.start();

app.post('/chat', async (req, res) => {
  const { message, sessionId } = req.body;

  // Get or create session
  const session = sessionId
    ? await agent.getSession(sessionId) ?? await agent.createSession(sessionId)
    : await agent.createSession();

  const response = await agent.generate(message, { sessionId: session.id });

  res.json({
    response: response.content,
    sessionId: session.id
  });
});

app.listen(3000);
```

### Streaming to Frontend (SSE)

```typescript
app.get('/chat/stream', async (req, res) => {
  const { message, sessionId } = req.query;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');

  for await (const event of await agent.stream(message, { sessionId })) {
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  res.end();
});
```

## Configuration Options

```typescript
const agent = new DextoAgent({
  // Required: LLM configuration
  llm: {
    provider: 'openai',
    model: 'gpt-5-mini',
    apiKey: process.env.OPENAI_API_KEY,
    temperature: 0.7,           // optional
    maxOutputTokens: 4000,      // optional
  },

  // Optional: System prompt
  systemPrompt: 'You are a helpful assistant.',

  // Optional: MCP servers
  mcpServers: {
    // ... server configs
  },

  // Optional: Storage backends (defaults to in-memory)
  storage: {
    cache: { type: 'redis', url: 'redis://localhost:6379' },
    database: { type: 'postgresql', url: process.env.DATABASE_URL }
  },

  // Optional: Logging
  logger: {
    level: 'info'  // error | warn | info | debug
  }
});
```

## Tutorial Series

Continue learning with these focused tutorials:

1. **[Quick Start](./quick-start.md)** - Minimal working example in 5 minutes
2. **[Sessions](./sessions.md)** - Multi-user patterns and session management
3. **[Streaming](./streaming.md)** - Real-time responses for UIs
4. **[Tools](./tools.md)** - Adding MCP tools and capabilities
5. **[Events](./events.md)** - Monitoring and analytics
6. **[Error Handling](./error-handling.md)** - Retry logic and graceful degradation

## API Reference

- **[DextoAgent API](/api/sdk/dexto-agent)** - Complete method documentation
- **[Events Reference](/api/sdk/events)** - All available events
- **[Types Reference](/api/sdk/types)** - TypeScript type definitions
