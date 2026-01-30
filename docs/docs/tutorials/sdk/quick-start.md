---
sidebar_position: 2
title: "Quick Start"
---

# Quick Start

Let's get your first AI response in under 5 minutes. No complexity, no explanations—just working code that proves the SDK does what you need.

## What You'll Build

A 15-line script that:
1. Creates an AI agent
2. Asks it a question
3. Prints the answer

That's it. Once this works, you'll know the SDK is set up correctly.

## Prerequisites

- Node.js 18 or higher
- An API key from [OpenAI](https://platform.openai.com), [Anthropic](https://console.anthropic.com), or [Cohere](https://dashboard.cohere.com)

## Install

```bash
npm install @dexto/core
```

## Write Your First Agent

Create `first-agent.ts`:

```typescript
import { DextoAgent } from '@dexto/core';

const agent = new DextoAgent({
  llm: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiKey: process.env.OPENAI_API_KEY
  }
});

await agent.start();
const session = await agent.createSession();

const response = await agent.generate('Explain TypeScript in one sentence.', session.id);

console.log(response.content);
await agent.stop();
```

## Run It

```bash
export OPENAI_API_KEY=your-key-here
npx tsx first-agent.ts
```

You should see a concise explanation of TypeScript. If you do, **you're done**. The SDK is working.

## What Just Happened?

Let's break down each step:

### 1. Configure the Agent

```typescript
const agent = new DextoAgent({
  llm: { provider: 'openai', model: 'gpt-4o-mini', apiKey: process.env.OPENAI_API_KEY }
});
```

**What it does:** Configure which LLM to use. That's it for setup—no complex initialization code needed.

---

### 2. Start the Agent

```typescript
await agent.start();
```

**What it does:** Initializes internal services (LLM client, storage, event system). The agent is now ready to process messages.

---

### 3. Create a Session

```typescript
const session = await agent.createSession();
```

**What it does:** Creates a conversation session to maintain working memory. Each session tracks its own conversation history.

---

### 4. Generate a Response

```typescript
const response = await agent.generate('What is TypeScript?', session.id);
console.log(response.content);
```

**What it does:** Send a message and get the AI response. The response includes the content, token usage, and any tool calls made.

---

### 5. Stop the Agent

```typescript
await agent.stop();
```

**What it does:** Clean up resources when you're done. Always call this to properly shut down services.

---

**The Pattern:** Every Dexto agent follows this lifecycle: **configure → start → create session → generate → stop**.

## Try Different Providers

Swap providers by changing three lines:

### Google (Gemini)

```typescript
const agent = new DextoAgent({
  llm: {
    provider: 'google',
    model: 'gemini-2.0-flash-exp',
    apiKey: process.env.GOOGLE_API_KEY
  }
});
```

### Anthropic (Claude)

```typescript
const agent = new DextoAgent({
  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-5-20250929',
    apiKey: process.env.ANTHROPIC_API_KEY
  }
});
```

### Cohere

```typescript
const agent = new DextoAgent({
  llm: {
    provider: 'cohere',
    model: 'command-a-03-2025',
    apiKey: process.env.COHERE_API_KEY
  }
});
```

### Local Models (Ollama, vLLM, etc.)

```typescript
const agent = new DextoAgent({
  llm: {
    provider: 'openai',
    model: 'llama-3.1-70b',
    apiKey: 'dummy',
    baseURL: 'http://localhost:8080/v1'
  }
});
```

Any OpenAI-compatible API works with `provider: 'openai'` and a custom `baseURL`.

## What's Next?

Right now your agent forgets everything after each run. In the next tutorial, you'll learn how sessions let your agent remember previous messages—the foundation for building real conversations.

**Continue to:** [Working with Sessions](./sessions.md)
