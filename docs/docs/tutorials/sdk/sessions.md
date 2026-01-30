---
sidebar_position: 3
title: "Working with Sessions"
---

# Working with Sessions

Sessions give your agent working memory—the ability to reference earlier messages in the current conversation, build context, and maintain coherent multi-turn interactions. Every conversation in Dexto happens within a session.

:::info What is Working Memory?
**Working memory** is the conversation history maintained within a session. It's the context the agent uses to understand and respond to your current conversation—like remembering what you said two messages ago.

This is distinct from other types of memory (like long-term facts or user preferences), which you'll learn about in later tutorials.
:::

## What Sessions Do

A session maintains conversation history (working memory). Messages in the same session can reference each other. Messages in different sessions are completely isolated.

Here's a conversation with working memory:

```typescript
const agent = new DextoAgent({
  llm: { provider: 'openai', model: 'gpt-4o-mini', apiKey: process.env.OPENAI_API_KEY }
});
await agent.start();

const session = await agent.createSession();

await agent.generate('My name is Sarah.', session.id);
const response = await agent.generate('What is my name?', session.id);

console.log(response.content);
// "Your name is Sarah."
```

The agent remembers because both messages used the same `sessionId`.

Now create a new session—this has no working memory of the first conversation:

```typescript
const newSession = await agent.createSession();
const response = await agent.generate('What is my name?', newSession.id);

console.log(response.content);
// "I don't have that information."
```

**Different sessions = isolated working memory.** This is how one agent can handle multiple users or conversation threads simultaneously—each with their own conversation context.

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

await agent.generate('I want to build a REST API in Node.js.', session.id);

await agent.generate('What framework should I use?', session.id);

const response = await agent.generate('Show me a simple example.', session.id);

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
await agent.generate(userMessage, sessionId);
```

### Pattern 2: Multiple Sessions Per User

Apps like ChatGPT where users create multiple conversation threads:

```typescript
// User creates a new chat
const sessionId = `user-${userId}-chat-${chatId}`;
await agent.createSession(sessionId);

// User switches between chats
await agent.generate(message, currentChatId);
```

### Pattern 3: Session Per Task

Short-lived sessions for specific tasks:

```typescript
// User starts a support ticket
const sessionId = `ticket-${ticketId}`;
await agent.createSession(sessionId);

// All messages related to this ticket use this session
await agent.generate(message, sessionId);

// Ticket resolved? Delete the session
await agent.deleteSession(sessionId);
```

## What's Next?

You now know how to give your agent working memory. But what if you have hundreds of users all talking to the same agent? You could create a new agent instance for each user, but that's wasteful.

In the next tutorial, you'll learn how one agent can serve multiple users simultaneously—each with their own isolated session and working memory.

**Continue to:** [Multi-User Chat Endpoint](./multi-user-chat.md)
