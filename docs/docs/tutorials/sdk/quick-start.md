---
sidebar_position: 2
title: "Quick Start"
---

# Quick Start

Get your first Dexto agent running in 5 minutes. This guide walks you through the minimal setup needed to start building with the Dexto Agent SDK.

## What You'll Learn

- Installing the Dexto SDK
- Creating your first agent
- Understanding the agent lifecycle
- Generating your first AI response

## Prerequisites

- Node.js 18 or higher
- An OpenAI API key (get one at [platform.openai.com](https://platform.openai.com))

## Installation

```bash
npm install @dexto/core
```

## Your First Agent

Create a file called `agent.ts` and add the following code:

```typescript
import { DextoAgent } from '@dexto/core';

async function main() {
  // 1. Create the agent with LLM configuration
  const agent = new DextoAgent({
    llm: {
      provider: 'openai',
      model: 'gpt-5-mini',
      apiKey: process.env.OPENAI_API_KEY
    }
  });

  // 2. Start the agent (initializes services)
  await agent.start();

  // 3. Create a session for the conversation
  const session = await agent.createSession();

  // 4. Generate a response
  const response = await agent.generate('What is TypeScript?', {
    sessionId: session.id
  });

  console.log(response.content);

  // 5. Clean up
  await agent.stop();
}

main();
```

Set your API key and run it:

```bash
export OPENAI_API_KEY=your-key-here
npx tsx agent.ts
```

You should see a detailed explanation of TypeScript.

## Understanding the Code

### Agent Creation

```typescript
const agent = new DextoAgent({
  llm: {
    provider: 'openai',
    model: 'gpt-5-mini',
    apiKey: process.env.OPENAI_API_KEY
  }
});
```

The `DextoAgent` constructor takes a configuration object. At minimum, you need to specify the LLM provider, model, and API key.

### Agent Lifecycle

```typescript
await agent.start();  // Initialize services
// ... use the agent ...
await agent.stop();   // Clean up resources
```

Always call `start()` before using the agent and `stop()` when you're done. The `start()` method initializes internal services like the LLM client, storage, and event system.

### Sessions

```typescript
const session = await agent.createSession();
```

Sessions maintain conversation context. Each session has its own isolated message history. You'll use the session ID when generating responses.

### Generating Responses

```typescript
const response = await agent.generate('What is TypeScript?', {
  sessionId: session.id
});
```

The `generate()` method is the recommended way to get responses from your agent. It returns a complete response object with:

- `content`: The generated text
- `usage`: Token usage information
- `reasoning`: Any reasoning steps (if available)
- `toolCalls`: Tools that were called (if any)
- `sessionId`: The session this response belongs to
- `messageId`: Unique identifier for this message

## Using Different Providers

The SDK supports multiple LLM providers. Here are examples:

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

### Local Models (OpenAI-compatible)

```typescript
const agent = new DextoAgent({
  llm: {
    provider: 'openai',
    model: 'llama-3.1-70b',
    apiKey: 'not-needed',
    baseURL: 'http://localhost:8080/v1'
  }
});
```

## Customizing the Agent

You can customize the agent's behavior with additional configuration:

```typescript
const agent = new DextoAgent({
  llm: {
    provider: 'openai',
    model: 'gpt-5-mini',
    apiKey: process.env.OPENAI_API_KEY,
    temperature: 0.7,        // Controls randomness (0-1)
    maxOutputTokens: 4000    // Maximum response length
  },
  systemPrompt: 'You are a helpful coding assistant specialized in TypeScript.'
});
```

## Error Handling

Always wrap agent operations in try-catch blocks:

```typescript
try {
  const agent = new DextoAgent(config);
  await agent.start();

  const session = await agent.createSession();
  const response = await agent.generate('Hello', { sessionId: session.id });

  console.log(response.content);

  await agent.stop();
} catch (error) {
  console.error('Agent error:', error);
  process.exit(1);
}
```

## Next Steps

Now that you have a basic agent running, learn about:

- **[Sessions](./sessions.md)** - Manage multiple conversations and users
- **[Streaming](./streaming.md)** - Real-time streaming for interactive UIs
- **[Tools](./tools.md)** - Add MCP tools to extend agent capabilities
