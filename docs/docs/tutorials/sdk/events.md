---
sidebar_position: 6
title: "Handling Events"
---

# Handling Events

Your agent can now chat, remember conversations, serve multiple users, and use tools. But there's a problem: **you can't see what it's doing.**

When a user sends a message, your UI is blind. It doesn't know if the agent is thinking, streaming text, or calling tools. Users just see... nothing.

## The Problem

Without events, your UI looks frozen:

```typescript
const agent = new DextoAgent({
  llm: { provider: 'openai', model: 'gpt-4o-mini', apiKey: process.env.OPENAI_API_KEY }
});
await agent.start();

const session = await agent.createSession();

console.log('Sending message...');
const response = await agent.generate('Explain quantum computing', session.id);
// 10 seconds of silence...

console.log('Done:', response.content);
```

Users see "Sending message..." then wait 10 seconds with no feedback. Not great.

## The Solution: Events

Listen to what the agent is doing:

```typescript
const agent = new DextoAgent({
  llm: { provider: 'openai', model: 'gpt-4o-mini', apiKey: process.env.OPENAI_API_KEY }
});

// Listen BEFORE starting
agent.on('llm:thinking', () => {
  console.log('Agent is thinking...');
});

agent.on('llm:chunk', ({ content }) => {
  process.stdout.write(content); // Stream text as it arrives
});

agent.on('llm:response', () => {
  console.log('\n✓ Complete');
});

await agent.start();
const session = await agent.createSession();
await agent.generate('Explain quantum computing', session.id);
```

Now users see:
1. "Agent is thinking..." (immediate feedback)
2. Text streaming word-by-word (real-time progress)
3. "Complete" (clear ending)

Much better!

## Core Events

### Thinking
```typescript
agent.on('llm:thinking', ({ sessionId }) => {
  showLoadingSpinner(sessionId);
});
```
Fires when the agent starts processing. Show a loading indicator.

### Streaming Text
```typescript
agent.on('llm:chunk', ({ sessionId, content }) => {
  appendText(sessionId, content);
});
```
Fires for each chunk of text. Build up the response in your UI.

### Response Complete
```typescript
agent.on('llm:response', ({ sessionId, content, usage }) => {
  hideLoadingSpinner(sessionId);
  console.log(`Tokens used: ${usage?.totalTokens}`);
});
```
Fires when done. Hide loading, show final message.

## Showing Tool Usage

When your agent uses tools, show what it's doing:

```typescript
agent.on('llm:tool-call', ({ sessionId, toolName, args }) => {
  showToolBanner(sessionId, `Using ${toolName}...`);
});

agent.on('llm:tool-result', ({ sessionId, toolName, success }) => {
  if (success) {
    hideToolBanner(sessionId);
  } else {
    showError(sessionId, `Failed to use ${toolName}`);
  }
});
```

This gives users confidence—they see the agent working, not just waiting.

## Complete Example

Here's a simple chat UI with event handling:

```typescript
import { DextoAgent } from '@dexto/core';

const agent = new DextoAgent({
  llm: { provider: 'openai', model: 'gpt-4o-mini', apiKey: process.env.OPENAI_API_KEY }
});

// Track UI state
const uiState = new Map<string, {
  status: 'idle' | 'thinking' | 'streaming';
  currentMessage: string;
}>();

agent.on('llm:thinking', ({ sessionId }) => {
  uiState.set(sessionId, { status: 'thinking', currentMessage: '' });
  updateUI(sessionId);
});

agent.on('llm:chunk', ({ sessionId, content }) => {
  const state = uiState.get(sessionId)!;
  state.status = 'streaming';
  state.currentMessage += content;
  updateUI(sessionId);
});

agent.on('llm:response', ({ sessionId }) => {
  const state = uiState.get(sessionId)!;
  state.status = 'idle';
  updateUI(sessionId);
});

function updateUI(sessionId: string) {
  const state = uiState.get(sessionId)!;

  if (state.status === 'thinking') {
    console.log(`[${sessionId}] 🤔 Thinking...`);
  } else if (state.status === 'streaming') {
    console.log(`[${sessionId}] ✍️  ${state.currentMessage}`);
  } else {
    console.log(`[${sessionId}] ✓ Done`);
  }
}

await agent.start();
```

## All Available Events

**LLM Events:**
- `llm:thinking` - Started processing
- `llm:chunk` - Text chunk arrived
- `llm:tool-call` - Calling a tool
- `llm:tool-result` - Tool finished
- `llm:response` - Response complete

**MCP Events:**
- `mcp:server-connected` - Tool server connected
- `mcp:server-disconnected` - Tool server disconnected

**Session Events:**
- `session:created` - New session created
- `session:deleted` - Session deleted

See the [Events API Reference](/api/sdk/events) for complete details.

## What's Next?

You've mastered the core SDK capabilities—creating agents, managing sessions, serving users, adding tools, and handling events. But you've been configuring everything inline with JavaScript objects.

Production applications need more: reusable configs, environment management, and programmatic agent orchestration. The next tutorials cover these production patterns.

**Continue to:** [Loading Agent Configs](./config-files.md)
