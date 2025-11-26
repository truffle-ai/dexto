---
sidebar_position: 3
title: "Working with Sessions"
---

# Working with Sessions

In the Quick Start, your agent answered one question and forgot everything. Real applications need memory—the ability to reference earlier messages, build context, and maintain coherent conversations. That's what sessions give you.

## The Problem: Stateless Agents

Here's what happens without sessions:

```typescript
const agent = new DextoAgent({
  llm: { provider: 'openai', model: 'gpt-4o-mini', apiKey: process.env.OPENAI_API_KEY }
});
await agent.start();

const session = await agent.createSession();

await agent.generate('My name is Sarah.', { sessionId: session.id });
const response = await agent.generate('What is my name?', { sessionId: session.id });

console.log(response.content);
// "Your name is Sarah."
```

Now remove the session:

```typescript
await agent.generate('My name is Sarah.'); // No sessionId
const response = await agent.generate('What is my name?'); // No sessionId

console.log(response.content);
// "I don't have that information."
```

**Sessions are how agents remember.** Each session maintains its own conversation history. Without one, every message is treated as a fresh conversation.

## Creating Sessions

Sessions are cheap—create as many as you need:

```typescript
const agent = new DextoAgent({
  llm: { provider: 'openai', model: 'gpt-4o-mini', apiKey: process.env.OPENAI_API_KEY }
});
await agent.start();

// Auto-generated ID
const session1 = await agent.createSession();
console.log(session1.id); // "sess_abc123def456"

// Custom ID (useful for mapping to users)
const session2 = await agent.createSession('user-sarah-2024');
console.log(session2.id); // "user-sarah-2024"
```

Custom IDs make it easy to tie sessions to your own user system. Just make sure they're unique.

## Building Multi-Turn Conversations

Pass the same `sessionId` on every message:

```typescript
const session = await agent.createSession('demo');

await agent.generate('I want to build a REST API in Node.js.', {
  sessionId: session.id
});

await agent.generate('What framework should I use?', {
  sessionId: session.id
});

const response = await agent.generate('Show me a simple example.', {
  sessionId: session.id
});

console.log(response.content);
// The agent remembers you want a Node.js REST API and suggests Express with example code
```

Each message adds to the session's history. The LLM sees the full conversation every time.

## Inspecting Session History

Check what the agent remembers:

```typescript
const history = await agent.getSessionHistory('demo');

for (const message of history) {
  console.log(`[${message.role}]: ${message.content.substring(0, 60)}...`);
}
```

Output:
```text
[user]: I want to build a REST API in Node.js.
[assistant]: Building a REST API in Node.js is a great choice. Here are...
[user]: What framework should I use?
[assistant]: Express is the most popular choice for Node.js REST APIs...
[user]: Show me a simple example.
[assistant]: Here's a minimal Express API...
```

This is useful for debugging, showing conversation history in your UI, or understanding token usage.

## Managing Sessions

### List All Active Sessions

```typescript
const sessions = await agent.listSessions();
console.log(`Active sessions: ${sessions.length}`);
```

### Check if a Session Exists

```typescript
const session = await agent.getSession('user-sarah-2024');
if (session) {
  console.log('Session found');
} else {
  console.log('Session not found - creating new one');
  await agent.createSession('user-sarah-2024');
}
```

### Reset a Session

Clear history but keep the session ID:

```typescript
await agent.resetConversation('demo');
// Session 'demo' still exists, but all messages are gone
```

Use this for "start new conversation" buttons in your UI.

### Delete a Session

Remove everything:

```typescript
await agent.deleteSession('demo');
// Session no longer exists
```

## When to Create Sessions

**One session per conversation thread.** Here are common patterns:

### Pattern 1: One Session Per User

Simple apps where each user has one ongoing conversation:

```typescript
// User logs in
const sessionId = `user-${userId}`;
const session = await agent.getSession(sessionId);

if (!session) {
  await agent.createSession(sessionId);
}

// Every message from this user uses the same session
await agent.generate(userMessage, { sessionId });
```

### Pattern 2: Multiple Sessions Per User

Apps like ChatGPT where users create multiple conversation threads:

```typescript
// User creates a new chat
const sessionId = `user-${userId}-chat-${chatId}`;
await agent.createSession(sessionId);

// User switches between chats
await agent.generate(message, { sessionId: currentChatId });
```

### Pattern 3: Session Per Task

Short-lived sessions for specific tasks:

```typescript
// User starts a support ticket
const sessionId = `ticket-${ticketId}`;
await agent.createSession(sessionId);

// All messages related to this ticket use this session
await agent.generate(message, { sessionId });

// Ticket resolved? Delete the session
await agent.deleteSession(sessionId);
```

## What's Next?

You now know how to give your agent memory. But what if you have hundreds of users all talking to the same agent? You could create a new agent instance for each user, but that's wasteful.

In the next tutorial, you'll learn how one agent can serve multiple users simultaneously—each with their own isolated session.

**Continue to:** [Multi-User Chat Endpoint](./multi-user-chat.md)
