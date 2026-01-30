---
id: multi-user-chat
sidebar_position: 4
title: "Multi-User Chat"
---

# Multi-User Chat

In the last tutorial, you learned that sessions give agents memory. Now here's the key insight: **one agent can manage hundreds of sessions simultaneously**. You don't need a separate agent instance for each user—you just map each user to their own session ID.

This tutorial has two parts:
- **Part I:** Understand the pattern programmatically
- **Part II:** Build an HTTP server to expose it

## Prerequisites

- Completed the [Sessions tutorial](./sessions.md)
- Node.js 18+
- `OPENAI_API_KEY` in your environment

## Part I: Understanding the Pattern

### The Core Idea

```
One Agent + Many Sessions = Multi-User Support

User A → Session A ┐
User B → Session B ├─→ Single DextoAgent
User C → Session C ┘
```

Each user gets their own session, but they all share the same agent instance.

### Build It Programmatically

Create `multi-user.ts`:

```typescript
import { DextoAgent } from '@dexto/core';

// One shared agent for all users
const agent = new DextoAgent({
  llm: { provider: 'openai', model: 'gpt-4o-mini', apiKey: process.env.OPENAI_API_KEY }
});
await agent.start();

// Track which session belongs to which user
const userSessions = new Map<string, string>();

async function getOrCreateSession(userId: string) {
  // Check if this user already has a session
  const existing = userSessions.get(userId);
  if (existing) return existing;

  // Create a new session for this user
  const session = await agent.createSession(`user-${userId}`);
  userSessions.set(userId, session.id);
  return session.id;
}

async function handleMessage(userId: string, message: string) {
  const sessionId = await getOrCreateSession(userId);
  const response = await agent.generate(message, sessionId);
  return response.content;
}
```

### Test It

Add a test function to verify it works:

```typescript
async function test() {
  console.log('Alice:', await handleMessage('alice', 'My name is Alice'));
  console.log('Bob:', await handleMessage('bob', 'My name is Bob'));
  console.log('Alice:', await handleMessage('alice', 'What is my name?'));
  // Should respond "Alice" - proving sessions are isolated
}

test().catch(console.error);
```

Run it:

```bash
export OPENAI_API_KEY=sk-...
npx tsx multi-user.ts
```

You should see Alice and Bob maintaining separate memories. This is the core pattern—master this before moving to HTTP.

### How It Works

```typescript
async function getOrCreateSession(userId: string) {
  const existing = userSessions.get(userId);
  if (existing) return existing;

  const session = await agent.createSession(`user-${userId}`);
  userSessions.set(userId, session.id);
  return session.id;
}
```

This function ensures:
- First message from a user → creates a new session
- Subsequent messages → reuses existing session
- Different users → different sessions

Once you understand this pattern, you can expose it over HTTP.

## Part II: Building the HTTP Server

Now let's make this accessible to frontends by adding an Express server.

### Install Express

```bash
npm install express
```

### Add the HTTP Layer

Create `chat-server.ts` with the same agent and session logic:

```typescript
import express from 'express';
import { DextoAgent } from '@dexto/core';

// One agent for everyone
const agent = new DextoAgent({
  llm: { provider: 'openai', model: 'gpt-4o-mini', apiKey: process.env.OPENAI_API_KEY }
});
await agent.start();

// Map users to sessions
const userSessions = new Map<string, string>();

async function getOrCreateSession(userId: string) {
  const existing = userSessions.get(userId);
  if (existing) return existing;

  const session = await agent.createSession(`user-${userId}`);
  userSessions.set(userId, session.id);
  return session.id;
}

// Express server
const app = express();
app.use(express.json());

app.post('/chat', async (req, res) => {
  try {
    const { userId, message } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message required' });
    }

    const sessionId = await getOrCreateSession(userId || 'anonymous');
    const response = await agent.generate(message, sessionId);

    res.json({ content: response.content, sessionId });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Chat server running on http://localhost:${PORT}`);
});
```

### Start the Server

```bash
export OPENAI_API_KEY=sk-...
npx tsx chat-server.ts
```

### Test with Multiple Users

In another terminal, send messages from different users:

```bash
# Alice's conversation
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"userId":"alice","message":"My favorite color is blue"}'

# Bob's conversation (completely separate)
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"userId":"bob","message":"My favorite color is red"}'

# Alice's follow-up
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"userId":"alice","message":"What is my favorite color?"}'
# Response: "Your favorite color is blue"
```

Perfect! One agent, multiple users, isolated conversations.

### Add Session Management (Optional)

Add endpoints for managing user sessions:

```typescript
// Reset a user's conversation
app.post('/chat/reset', async (req, res) => {
  const { userId } = req.body;
  const sessionId = userSessions.get(userId);

  if (sessionId) {
    await agent.resetConversation(sessionId);
    res.json({ success: true });
  } else {
    res.json({ success: false, message: 'No active session' });
  }
});

// List active users
app.get('/chat/users', async (req, res) => {
  const users = Array.from(userSessions.keys());
  res.json({ users, count: users.length });
});
```

Test the reset:

```bash
curl -X POST http://localhost:3000/chat/reset \
  -H "Content-Type: application/json" \
  -d '{"userId":"alice"}'
```

## Key Takeaways

**The Pattern:**
- One agent instance shared across all users
- One session per user, stored in a Map
- Session lookup/creation handled by `getOrCreateSession()`

**Why It Works:**
- Agent instances are expensive (they load models, connect to services)
- Sessions are cheap (just conversation history)
- Sharing one agent is efficient and scales well

**Production Note:**
In production, store `userSessions` in Redis or a database instead of memory, so sessions persist across server restarts.

## What's Next?

Your agent can now handle multiple users, but it's still just a text generator. What if it could read files, search the web, or query databases? That's where tools come in.

**Continue to:** [Adding Tools](./tools.md)
