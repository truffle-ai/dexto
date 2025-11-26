---
sidebar_position: 3
title: "Sessions"
---

# Sessions

Sessions are the foundation of multi-user applications with Dexto. Each session maintains its own conversation history, allowing you to build chatbots, support systems, and collaborative AI applications.

## What You'll Learn

- Creating and managing sessions
- Multi-user conversation patterns
- Session lifecycle management
- Retrieving conversation history

## Session Basics

A session represents a single conversation thread. Each session has:

- **Unique ID**: Identifier for the session
- **Message history**: All messages and responses in this conversation
- **Isolated context**: Sessions don't share information with each other

### Creating a Session

```typescript
import { DextoAgent } from '@dexto/core';

const agent = new DextoAgent({
  llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: process.env.OPENAI_API_KEY }
});
await agent.start();

// Create a session with auto-generated ID
const session = await agent.createSession();
console.log(session.id); // e.g., "sess_abc123"

// Create a session with custom ID
const userSession = await agent.createSession('user-123');
console.log(userSession.id); // "user-123"
```

### Using Sessions

Always pass the `sessionId` when generating responses:

```typescript
const response = await agent.generate('What is React?', {
  sessionId: session.id
});

// The agent remembers this conversation
const followUp = await agent.generate('How does it differ from Vue?', {
  sessionId: session.id
});
```

## Multi-User Patterns

### Basic Multi-User Chat

Track sessions for multiple users with a Map:

```typescript
class ChatBot {
  private agent: DextoAgent;
  private sessions = new Map<string, string>();

  async initialize() {
    this.agent = new DextoAgent({
      llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: process.env.OPENAI_API_KEY }
    });
    await this.agent.start();
  }

  async handleMessage(userId: string, message: string): Promise<string> {
    // Get existing session or create new one
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

  async resetUser(userId: string): Promise<void> {
    const sessionId = this.sessions.get(userId);
    if (sessionId) {
      await this.agent.resetConversation(sessionId);
    }
  }
}

// Usage
const bot = new ChatBot();
await bot.initialize();

const response1 = await bot.handleMessage('alice', 'Hi!');
const response2 = await bot.handleMessage('bob', 'Hello!');
const response3 = await bot.handleMessage('alice', 'What did I just say?');
// alice's session remembers "Hi!", bob's is separate
```

### Web Application Pattern

Integration with Express:

```typescript
import express from 'express';
import { DextoAgent } from '@dexto/core';

const app = express();
app.use(express.json());

const agent = new DextoAgent({
  llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: process.env.OPENAI_API_KEY }
});
await agent.start();

app.post('/chat', async (req, res) => {
  const { message, sessionId } = req.body;

  // Get existing session or create new one
  let session;
  if (sessionId) {
    const existing = await agent.getSession(sessionId);
    session = existing ?? await agent.createSession(sessionId);
  } else {
    session = await agent.createSession();
  }

  const response = await agent.generate(message, { sessionId: session.id });

  res.json({
    response: response.content,
    sessionId: session.id
  });
});

app.listen(3000);
```

Client usage:

```javascript
// First message - no sessionId
let sessionId = null;

const response1 = await fetch('/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: 'Hello' })
});
const data1 = await response1.json();
sessionId = data1.sessionId; // Save for future requests

// Follow-up message - use saved sessionId
const response2 = await fetch('/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: 'What did I just say?',
    sessionId: sessionId
  })
});
```

## Session Management

### List All Sessions

```typescript
const sessions = await agent.listSessions();
console.log(`Active sessions: ${sessions.length}`);
```

### Get Session Details

```typescript
const session = await agent.getSession('user-123');
if (session) {
  console.log(`Session ${session.id} exists`);
} else {
  console.log('Session not found');
}
```

### Get Conversation History

```typescript
const history = await agent.getSessionHistory('user-123');
for (const message of history) {
  console.log(`${message.role}: ${message.content}`);
}
```

Example output:
```
user: What is TypeScript?
assistant: TypeScript is a strongly typed programming language...
user: How do I install it?
assistant: You can install TypeScript using npm...
```

### Reset a Session

Clear conversation history while keeping the session:

```typescript
await agent.resetConversation('user-123');
// Session still exists but history is cleared
```

### Delete a Session

Completely remove a session:

```typescript
await agent.deleteSession('user-123');
// Session no longer exists
```

## Session Lifecycle

### Automatic Cleanup

Configure session TTL to automatically remove old sessions:

```typescript
const agent = new DextoAgent({
  llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: process.env.OPENAI_API_KEY },
  sessions: {
    maxSessions: 1000,
    sessionTTL: 24 * 60 * 60 * 1000 // 24 hours in milliseconds
  }
});
```

This helps manage memory usage while preserving chat history in storage.

### Resuming Conversations

Pattern for resuming user conversations:

```typescript
async function resumeOrCreate(agent: DextoAgent, userId: string) {
  const sessionId = `user-${userId}`;

  // Check if session exists
  const sessions = await agent.listSessions();
  if (sessions.includes(sessionId)) {
    // Load existing history
    const history = await agent.getSessionHistory(sessionId);
    return { sessionId, history };
  } else {
    // Create new session
    const session = await agent.createSession(sessionId);
    return { sessionId: session.id, history: [] };
  }
}

// Usage
const { sessionId, history } = await resumeOrCreate(agent, '123');
if (history.length > 0) {
  console.log('Resuming conversation...');
  // Display previous messages to user
} else {
  console.log('Starting new conversation...');
}
```

## Persistent Storage

Sessions are stored in memory by default. For production applications, use persistent storage:

```typescript
const agent = new DextoAgent({
  llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: process.env.OPENAI_API_KEY },
  storage: {
    cache: { type: 'redis', url: 'redis://localhost:6379' },
    database: { type: 'postgresql', url: process.env.DATABASE_URL }
  }
});
```

This ensures sessions survive application restarts.

## Best Practices

### 1. Use Meaningful Session IDs

```typescript
// Good - clear what this session represents
await agent.createSession('user-alice-support');
await agent.createSession('team-dev-standup');

// Avoid - hard to debug
await agent.createSession('12345');
```

### 2. Clean Up Old Sessions

```typescript
// Periodic cleanup task
setInterval(async () => {
  const sessions = await agent.listSessions();
  for (const sessionId of sessions) {
    const session = await agent.getSession(sessionId);
    // Implement your cleanup logic
  }
}, 60 * 60 * 1000); // Every hour
```

### 3. Handle Missing Sessions Gracefully

```typescript
async function chat(message: string, sessionId: string) {
  let session = await agent.getSession(sessionId);
  if (!session) {
    // Session expired or deleted - create new one
    session = await agent.createSession(sessionId);
    console.log('Session expired, created new one');
  }

  return await agent.generate(message, { sessionId: session.id });
}
```

## Next Steps

- **[Streaming](./streaming.md)** - Add real-time streaming to your chat UI
- **[Tools](./tools.md)** - Give your agent access to MCP tools
- **[Events](./events.md)** - Monitor session activity with events
