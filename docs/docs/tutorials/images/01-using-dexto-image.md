---
sidebar_position: 1
slug: /tutorials/images/01-using-dexto-image
---

# Dexto Images

The fastest way to build a Dexto agent is to use an official image. This tutorial shows you how to create an agent with zero boilerplate.

## What You'll Learn

- How to install and use a Dexto image
- The power of pre-configured infrastructure
- How side-effect registration works
- Accessing image metadata

## Prerequisites

- Node.js 18+ installed
- An OpenAI or Anthropic API key
- Basic TypeScript knowledge

## Step 1: Create Your Project

```bash
dexto create-app my-agent
```

When prompted, choose:
- "Use official image" (default)
- Select `@dexto/image-local` as the base image

This creates a project with:
- Pre-configured `package.json` with the image as a dependency
- Example agent configuration in `agents/default.yml`
- Ready-to-run structure

## Step 2: Configure Your Agent

Open `agents/default.yml` and update it:

```yaml
name: my-agent
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

## Step 3: Create Your Agent

Create `src/index.ts`:

```typescript
import { createAgent } from '@dexto/image-local';
import { loadAgentConfig } from '@dexto/agent-management';

async function main() {
  // Load configuration
  const config = await loadAgentConfig('./agents/default.yml');

  // Create agent with pre-configured harness
  const agent = createAgent(config, './agents/default.yml');

  // Start the agent
  await agent.start();

  // Create a session
  const session = await agent.createSession();

  // Send a message
  const response = await agent.run(
    'Hello! Can you introduce yourself?',
    undefined,
    undefined,
    session.id
  );

  console.log('Agent:', response.content);

  // Cleanup
  await agent.stop();
}

main().catch(console.error);
```

When you import `createAgent` from the image, it automatically registers all providers that make up the harness - blob storage, databases, caches, and built-in tools. The harness is ready to orchestrate your agent's operations without any manual setup.

## Step 4: Run Your Agent

```bash
export OPENAI_API_KEY="sk-..."
npx tsx src/index.ts
```

The image provides storage (SQLite, filesystem), built-in tools, and plugin infrastructure. You can override defaults in your YAML config, and the harness works with 50+ LLM providers by changing the `llm.provider` field.

## Next Steps

Now that you know how to use images, learn how to customize them:

- [Adding Custom Tools](/docs/tutorials/images/02-adding-custom-tools) - Add your own functionality
- [Building Your Own Image](/docs/tutorials/images/03-building-your-image) - Create organizational standards
- [Building a Web App](/docs/tutorials/images/04-building-web-app) - Turn your agent into a web service

## Key Takeaways

✅ Images eliminate boilerplate
✅ Side-effect registration happens on import
✅ Use `createAgent()` factory instead of `new DextoAgent()`
✅ Configuration can override image defaults
✅ Perfect for getting started quickly
