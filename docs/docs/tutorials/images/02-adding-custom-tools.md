---
sidebar_position: 2
slug: /tutorials/images/02-adding-custom-tools
---

# Adding Custom Tools

This tutorial shows how to extend an official image with your own tools at runtime, without building a new image.

## What You'll Build

A weather agent that combines:
- Official image infrastructure (storage, database)
- Official image tools (text utilities)
- Your custom tool (weather information)

## Prerequisites

- Completed the [Using Dexto Images](./01-using-dexto-image) tutorial
- An OpenAI or Anthropic API key

## Step 1: Set Up Your Project

```bash
dexto create-app weather-agent --extend-image
```

When prompted:
- Select `@dexto/image-local` as the base image
- Choose "Yes" to include an example custom tool

This creates a project with:
- Base image infrastructure pre-configured
- Convention-based folders (`tools/`, `plugins/`, etc.)
- Bundler scripts for building your extensions
- Example tool to guide you

## Step 2: Create a Custom Tool

Create `tools/weather-tool/index.ts`:

```typescript
import { z } from 'zod';
import type { CustomToolProvider } from '@dexto/core';

export const weatherToolProvider: CustomToolProvider<'weather-helper'> = {
  type: 'weather-helper',

  // Configuration schema
  configSchema: z.object({
    type: z.literal('weather-helper'),
    defaultCity: z.string().default('New York'),
    units: z.enum(['celsius', 'fahrenheit']).default('fahrenheit'),
  }),

  // Create the tool
  create: (config, context) => [
    {
      id: 'get_weather',
      description: 'Get current weather for a city',
      inputSchema: z.object({
        city: z.string().describe('City name'),
        units: z.enum(['celsius', 'fahrenheit']).optional(),
      }),

      // Tool execution
      execute: async (input) => {
        const city = input.city || config.defaultCity;
        const units = input.units || config.units;

        // Mock weather data (in production, call a real API)
        const temp = units === 'celsius' ? 22 : 72;

        return {
          city,
          temperature: temp,
          units,
          conditions: 'Partly cloudy',
          timestamp: new Date().toISOString(),
        };
      },
    },
  ],

  metadata: {
    displayName: 'Weather Helper',
    description: 'Provides weather information for cities',
    category: 'utilities',
  },
};
```

A custom tool provider has three parts:
- **configSchema** - Defines configuration options (default city, temperature units)
- **create** - Returns the actual tool(s) the agent can use
- **metadata** - Display information for documentation

This tool returns mock data. In a real application, you'd call an actual weather API in the `execute` function.

## Step 3: Configure Your Agent

Create `agents/default.yml`:

```yaml
systemPrompt:
  contributors:
    - type: static
      content: |
        You are a helpful AI assistant with access to:
        - Weather information (custom tool)
        - Text utilities (from base image)

llm:
  provider: openai
  model: gpt-4o-mini
  apiKey: $OPENAI_API_KEY

customTools:
  # Your custom tool
  - type: weather-helper
    defaultCity: San Francisco
    units: fahrenheit

  # Text utils from the base image
  - type: text-utils
    maxLength: 10000
```

## Step 4: Register and Use the Tool

Create `src/index.ts`:

```typescript
import { createAgent, customToolRegistry } from '@dexto/image-local';
import { loadAgentConfig } from '@dexto/agent-management';
import { weatherToolProvider } from '../tools/weather-tool/index.js';

async function main() {
  // Register custom tool BEFORE creating the agent
  customToolRegistry.register(weatherToolProvider);

  // Load config and create agent
  const config = await loadAgentConfig('./agents/default.yml');
  const agent = createAgent(config, './agents/default.yml');

  await agent.start();
  const session = await agent.createSession();

  // Test the custom weather tool
  const response1 = await agent.run(
    'What is the weather in San Francisco?',
    undefined,
    undefined,
    session.id
  );
  console.log('Weather:', response1.content);

  // Test the text-utils tool from base image
  const response2 = await agent.run(
    'Count the words in: hello world from weather agent',
    undefined,
    undefined,
    session.id
  );
  console.log('Word count:', response2.content);

  await agent.stop();
}

main().catch(console.error);
```

Notice the import: `customToolRegistry` comes from `@dexto/image-local`, not `@dexto/core`. The image re-exports registries, so you don't need `@dexto/core` as a dependency.

The registration must happen before creating the agent. Once the agent is created, the harness includes both the official image tools (text-utils) and your custom additions (weather-helper).

## Step 5: Run Your Agent

```bash
export OPENAI_API_KEY="sk-..."
npx tsx src/index.ts
```

The agent now uses both the custom weather tool and the text-utils tool from the base image. Both are available without any special handling - the harness orchestrates all tools regardless of their source.

## Next Steps

- [Building Your Own Image](/docs/tutorials/images/03-building-your-image) - Create distributable images
- [Building a Web App](/docs/tutorials/images/04-building-web-app) - Turn your agent into a web service

## Key Takeaways

✅ Import registries from the image, not @dexto/core
✅ Register tools before creating the agent
✅ The harness orchestrates both image tools and runtime additions
✅ No build step required
✅ Perfect for app-specific functionality
