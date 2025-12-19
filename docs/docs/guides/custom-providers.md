---
sidebar_position: 2
title: Building Custom Providers
description: Learn how to create custom tool providers for Dexto agents
---

# Building Custom Providers

Custom providers let you extend Dexto with new capabilities. This guide shows you how to create your own provider packages.

## What is a Provider?

A provider is an npm package that:
1. Implements one of Dexto's provider interfaces
2. Registers itself into Dexto's registries
3. Provides focused functionality (tools, storage, etc.)

Think of providers like plugins - self-contained packages that add specific features.

## When to Create a Provider

Create a custom provider when you need:

- **API Integrations** - Connect to Salesforce, Jira, Slack, etc.
- **Custom Tools** - Add company-specific functionality
- **Storage Backends** - Use MongoDB, Redis, custom databases
- **Specialized Functions** - Image processing, data analysis, etc.

:::tip Start Simple
If you only need 1-2 custom tools for a single app, you might not need a full provider package. Just register tools directly in your application code. Create a provider when you want to distribute functionality across multiple projects.
:::

## Provider Types

Dexto supports several provider types:

| Type | Purpose | Interface |
|------|---------|-----------|
| **Custom Tools** | Add agent tools | `CustomToolProvider` |
| **Blob Storage** | File storage backends | `BlobStoreProvider` |
| **Compression** | Context compression | `CompressionProvider` |
| **System Prompts** | Dynamic prompts | `SystemPromptContributor` |

This guide focuses on **Custom Tool Providers** - the most common type.

## Creating a Custom Tool Provider

### Step 1: Set Up Your Package

```bash
mkdir my-custom-tools
cd my-custom-tools
npm init -y
npm install @dexto/core zod
```

**package.json:**
```json
{
  "name": "@mycompany/custom-tools",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "peerDependencies": {
    "@dexto/core": "^1.0.0"
  }
}
```

### Step 2: Define Your Provider

Create `src/index.ts`:

```typescript
import { CustomToolProvider, Tool, ToolCreationContext } from '@dexto/core';
import { z } from 'zod';

/**
 * Configuration schema for your provider
 */
const MyToolsConfigSchema = z.object({
  apiKey: z.string().optional(),
  endpoint: z.string().url().optional(),
  // Add your config options
});

type MyToolsConfig = z.infer<typeof MyToolsConfigSchema>;

/**
 * Your custom tool provider
 */
export const myCustomToolsProvider: CustomToolProvider = {
  // Unique identifier for this provider
  type: 'my-custom-tools',

  // Display name shown in logs
  displayName: 'My Custom Tools',

  // Semantic version
  version: '1.0.0',

  // Optional: Config schema for validation
  configSchema: MyToolsConfigSchema,

  /**
   * Initialize the provider and return tools
   */
  async initialize(config: MyToolsConfig, context: ToolCreationContext) {
    // Validate config
    const validatedConfig = MyToolsConfigSchema.parse(config);

    // Create your tools
    const tools: Tool[] = [
      {
        name: 'my_custom_tool',
        description: 'Does something useful',

        // Define input schema
        inputSchema: {
          type: 'object',
          properties: {
            input: {
              type: 'string',
              description: 'The input to process'
            }
          },
          required: ['input']
        },

        // Implement the tool logic
        execute: async (input: { input: string }) => {
          try {
            // Your tool logic here
            const result = await doSomething(input.input);

            return {
              content: [
                {
                  type: 'text',
                  text: `Result: ${result}`
                }
              ]
            };
          } catch (error) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Error: ${error.message}`
                }
              ],
              isError: true
            };
          }
        }
      }
    ];

    return { tools };
  }
};

// Helper function (example)
async function doSomething(input: string): Promise<string> {
  // Your implementation
  return `Processed: ${input}`;
}
```

### Step 3: Auto-Register (Optional but Recommended)

Add a top-level side-effect that auto-registers your provider:

```typescript
// src/index.ts (add at the bottom)
import { customToolRegistry } from '@dexto/core';

// Auto-register when this module is imported
customToolRegistry.register(myCustomToolsProvider);

console.log('✓ Registered custom tools provider');
```

Now users can just import your package and the provider auto-registers!

### Step 4: Build and Publish

```bash
# Build
tsc

# Publish to npm
npm publish
```

## Using Your Custom Provider

### In Agent Config

```yaml
# agent.yml
customTools:
  - type: my-custom-tools
    apiKey: "your-api-key"
    endpoint: "https://api.example.com"
```

### In Application Code

**If you added auto-registration:**
```typescript
import '@mycompany/custom-tools';  // Auto-registers
import { DextoAgent } from '@dexto/core';

const agent = new DextoAgent(config, path);
```

**Manual registration:**
```typescript
import { customToolRegistry } from '@dexto/core';
import { myCustomToolsProvider } from '@mycompany/custom-tools';

customToolRegistry.register(myCustomToolsProvider);

const agent = new DextoAgent(config, path);
```

## Real-World Example: Weather Tool

Let's build a complete weather tool provider:

```typescript
import { CustomToolProvider, Tool } from '@dexto/core';
import { z } from 'zod';

// Config schema
const WeatherConfigSchema = z.object({
  apiKey: z.string().describe('OpenWeather API key'),
  units: z.enum(['metric', 'imperial']).default('metric')
});

type WeatherConfig = z.infer<typeof WeatherConfigSchema>;

// Provider definition
export const weatherToolProvider: CustomToolProvider = {
  type: 'weather-tools',
  displayName: 'Weather Tools',
  version: '1.0.0',
  configSchema: WeatherConfigSchema,

  async initialize(config: WeatherConfig) {
    const tools: Tool[] = [
      {
        name: 'get_weather',
        description: 'Get current weather for a city',

        inputSchema: {
          type: 'object',
          properties: {
            city: {
              type: 'string',
              description: 'City name (e.g., "London", "New York")'
            }
          },
          required: ['city']
        },

        execute: async (input: { city: string }) => {
          try {
            // Call OpenWeather API
            const url = `https://api.openweathermap.org/data/2.5/weather?q=${input.city}&appid=${config.apiKey}&units=${config.units}`;
            const response = await fetch(url);
            const data = await response.json();

            if (!response.ok) {
              throw new Error(data.message || 'Failed to fetch weather');
            }

            const temp = data.main.temp;
            const description = data.weather[0].description;
            const humidity = data.main.humidity;

            return {
              content: [{
                type: 'text',
                text: `Weather in ${input.city}:\n` +
                      `Temperature: ${temp}°${config.units === 'metric' ? 'C' : 'F'}\n` +
                      `Conditions: ${description}\n` +
                      `Humidity: ${humidity}%`
              }]
            };
          } catch (error) {
            return {
              content: [{
                type: 'text',
                text: `Failed to get weather: ${error.message}`
              }],
              isError: true
            };
          }
        }
      }
    ];

    return { tools };
  }
};

// Auto-register
import { customToolRegistry } from '@dexto/core';
customToolRegistry.register(weatherToolProvider);
```

**Usage in config:**
```yaml
customTools:
  - type: weather-tools
    apiKey: "your-openweather-api-key"
    units: metric

toolPolicies:
  alwaysAllow:
    - custom--weather-tools--get_weather
```

## Advanced Features

### Bidirectional Services

If your provider needs to both provide tools AND trigger agent actions:

```typescript
export const myProvider: CustomToolProvider = {
  type: 'my-tools',
  // ...

  async initialize(config, context) {
    // Access the agent if you need bidirectional communication
    const agent = context.agent;

    // Your tool can trigger agent actions
    const myTool: Tool = {
      name: 'my_tool',
      // ...
      execute: async (input) => {
        // Do work, then optionally trigger agent
        await agent.run('Some message based on tool result');
        // ...
      }
    };

    return { tools: [myTool] };
  }
};
```

### Resource Management

Clean up resources when agent stops:

```typescript
export const myProvider: CustomToolProvider = {
  type: 'my-tools',
  // ...

  async initialize(config, context) {
    const connection = await connectToDatabase();

    // Register cleanup
    context.onDispose(async () => {
      await connection.close();
      console.log('Cleaned up database connection');
    });

    // Return tools
    return { tools: [...] };
  }
};
```

### Multiple Tools

Provide multiple related tools:

```typescript
async initialize(config, context) {
  const tools: Tool[] = [
    {
      name: 'create_item',
      description: 'Create a new item',
      // ...
    },
    {
      name: 'get_item',
      description: 'Get an item by ID',
      // ...
    },
    {
      name: 'list_items',
      description: 'List all items',
      // ...
    },
    {
      name: 'delete_item',
      description: 'Delete an item',
      // ...
    }
  ];

  return { tools };
}
```

## Best Practices

### 1. Clear Naming

```typescript
// ✅ Good - describes what it does
name: 'get_weather'

// ❌ Bad - too generic
name: 'fetch'
```

### 2. Detailed Descriptions

```typescript
// ✅ Good - agent understands when to use it
description: 'Get current weather conditions for a specific city. Returns temperature, conditions, and humidity.'

// ❌ Bad - too vague
description: 'Get weather'
```

### 3. Validate Inputs

```typescript
execute: async (input: { city: string }) => {
  // ✅ Validate before processing
  if (!input.city || input.city.trim().length === 0) {
    return {
      content: [{ type: 'text', text: 'City name is required' }],
      isError: true
    };
  }

  // Process...
}
```

### 4. Handle Errors Gracefully

```typescript
try {
  const result = await apiCall();
  return { content: [{ type: 'text', text: result }] };
} catch (error) {
  // ✅ Return error in tool format
  return {
    content: [{
      type: 'text',
      text: `Failed to complete operation: ${error.message}`
    }],
    isError: true
  };
}
```

### 5. Type Your Config

```typescript
// ✅ Use Zod for validation
const ConfigSchema = z.object({
  apiKey: z.string().min(1),
  timeout: z.number().positive().default(5000)
});

type Config = z.infer<typeof ConfigSchema>;
```

## Testing Your Provider

```typescript
import { describe, it, expect } from 'vitest';
import { myCustomToolsProvider } from './index';

describe('MyCustomToolsProvider', () => {
  it('should initialize successfully', async () => {
    const config = {
      apiKey: 'test-key',
      endpoint: 'https://api.test.com'
    };

    const result = await myCustomToolsProvider.initialize(config, {});

    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe('my_custom_tool');
  });

  it('should execute tool correctly', async () => {
    const config = { apiKey: 'test-key' };
    const { tools } = await myCustomToolsProvider.initialize(config, {});

    const result = await tools[0].execute({ input: 'test' });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('Processed');
  });
});
```

## Distributing Your Provider

### As npm Package

```bash
# Public npm package
npm publish

# Private package
npm publish --access restricted
```

### In a Custom Image

Bundle your provider in a custom image for easy distribution. See the image examples in the repository for details.

### Inline (Quick Testing)

For rapid development, define providers inline:

```typescript
// app.ts
import { customToolRegistry, CustomToolProvider } from '@dexto/core';

const myQuickProvider: CustomToolProvider = {
  type: 'quick-test',
  displayName: 'Quick Test',
  version: '0.0.1',
  async initialize() {
    return {
      tools: [{
        name: 'test_tool',
        description: 'A quick test tool',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => ({
          content: [{ type: 'text', text: 'It works!' }]
        })
      }]
    };
  }
};

customToolRegistry.register(myQuickProvider);

// Now create agent...
```

## Next Steps

- Check [Understanding Architecture](./understanding-architecture) for the big picture
- Explore the configuring-dexto guides for agent configuration
- See example providers in the repository packages

## Resources

- [Example Providers](https://github.com/anthropics/dexto/tree/main/packages)
- Check the repository for image examples

---

**Questions?** Join our [Discord community](https://discord.gg/dexto) or explore the documentation.
