# @dexto/core

TypeScript SDK for building agentic applications programmatically. This package powers the Dexto CLI and lets you embed the same agent runtime in your own apps.

## Installation

```bash
npm install @dexto/core
```

## Quick Start

```ts
import { DextoAgent } from '@dexto/core';

// Create and start agent
const agent = new DextoAgent({
  llm: {
    provider: 'openai',
    model: 'gpt-4.1-mini',
    apiKey: process.env.OPENAI_API_KEY
  }
});
await agent.start();

// Run tasks
const response = await agent.run('List the 5 largest files in this repo');
console.log(response);

// Hold conversations
await agent.run('Write a haiku about TypeScript');
await agent.run('Make it funnier');

await agent.stop();
```

See the TypeScript SDK docs for full examples with MCP tools, sessions, and advanced features:
https://docs.dexto.ai/api/category/typescript-sdk/

---

### Session Management

Create and manage multiple conversation sessions with persistent storage.

```typescript
const agent = new DextoAgent(config);
await agent.start();

// Create and manage sessions
const session = await agent.createSession('user-123');
await agent.run('Hello, how can you help me?', undefined, 'user-123');

// List and manage sessions
const sessions = await agent.listSessions();
const sessionHistory = await agent.getSessionHistory('user-123');
await agent.deleteSession('user-123');

// Search across conversations
const results = await agent.searchMessages('bug fix', { limit: 10 });
```

### LLM Management

Switch between models and providers dynamically.

```typescript
// Get current configuration
const currentLLM = agent.getCurrentLLMConfig();

// Switch models (provider inferred automatically)
await agent.switchLLM({ model: 'gpt-4.1-mini' });
await agent.switchLLM({ model: 'claude-4-sonnet-20250514' });

// Switch model for a specific session id 1234
await agent.switchLLM({ model: 'gpt-4.1-mini' }, '1234')

// Get supported providers and models
const providers = agent.getSupportedProviders();
const models = agent.getSupportedModels();
const openaiModels = agent.getSupportedModelsForProvider('openai');
```

### MCP Manager

For advanced MCP server management, use the MCPManager directly.

```typescript
import { MCPManager } from '@dexto/core';

const manager = new MCPManager();

// Connect to MCP servers
await manager.connectServer('filesystem', {
  type: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '.']
});

// Access tools, prompts, and resources
const tools = await manager.getAllTools();
const prompts = await manager.getAllPrompts();
const resources = await manager.getAllResources();

// Execute tools
const result = await manager.executeTool('readFile', { path: './README.md' });

await manager.disconnectAll();
```

See the DextoAgent API reference for all methods:
https://docs.dexto.ai/api/dexto-agent/

---

## Links

- Docs: https://docs.dexto.ai/
- Configuration Guide: https://docs.dexto.ai/docs/category/guides/
- API Reference: https://docs.dexto.ai/api/

## License

Elastic License 2.0. See the repository LICENSE for details.

