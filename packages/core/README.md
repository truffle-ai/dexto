# @dexto/core

The Dexto Agent SDK for building agentic applications programmatically. This package powers the Dexto CLI and lets you embed the same agent runtime in your own apps.

## Installation

```bash
npm install @dexto/core
```

### Optional Dependencies

Some features require additional packages. Install only what you need:

```bash
# Telemetry (OpenTelemetry distributed tracing)
npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node \
  @opentelemetry/resources @opentelemetry/semantic-conventions \
  @opentelemetry/sdk-trace-base @opentelemetry/exporter-trace-otlp-http

# For gRPC telemetry export protocol
npm install @opentelemetry/exporter-trace-otlp-grpc

# Storage backends
npm install pg              # PostgreSQL database
npm install ioredis         # Redis cache

# TypeScript plugin support
npm install tsx
```

If you configure a feature without its dependencies, you'll get a helpful error message with the exact install command.

> **Note:** The `dexto` CLI package includes all optional dependencies. These are only needed when using `@dexto/core` directly as a library.

## Quick Start

```ts
import { DextoAgent } from '@dexto/core';

// Create and start agent
const agent = new DextoAgent({
  llm: {
    provider: 'openai',
    model: 'gpt-5-mini',
    apiKey: process.env.OPENAI_API_KEY
  }
});
await agent.start();

// Create a session for the conversation
const session = await agent.createSession();

// Use generate() for simple request/response
const response = await agent.generate('What is TypeScript?', session.id);
console.log(response.content);

// Conversations maintain context within a session
await agent.generate('Write a haiku about it', session.id);
await agent.generate('Make it funnier', session.id);

// Multimodal: send images or files
await agent.generate([
  { type: 'text', text: 'Describe this image' },
  { type: 'image', image: base64Data, mimeType: 'image/png' }
], session.id);

// Streaming for real-time UIs
for await (const event of await agent.stream('Write a story', session.id)) {
  if (event.name === 'llm:chunk') process.stdout.write(event.content);
}

await agent.stop();
```

See the [Dexto Agent SDK docs](https://docs.dexto.ai/docs/guides/dexto-sdk) for multimodal content, streaming, MCP tools, and advanced features.

---

### Starting a Server

Start a Dexto server programmatically to expose REST and SSE streaming APIs to interact and manage your agent backend.

```typescript
import { DextoAgent } from '@dexto/core';
import { startHonoApiServer } from 'dexto';

// Create and configure agent
const agent = new DextoAgent({
  llm: {
    provider: 'openai',
    model: 'gpt-5-mini',
    apiKey: process.env.OPENAI_API_KEY
  },
  mcpServers: {
    filesystem: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '.']
    }
  }
});

// Start server on port 3001
const { server } = await startHonoApiServer(agent, 3001);

console.log('Dexto server running at http://localhost:3001');
// Server provides REST API and SSE streaming endpoints
// POST /api/message - Send messages
// GET /api/sessions - List sessions
// See docs.dexto.ai/api/rest/ for all endpoints
```

This starts an HTTP server with full REST and SSE APIs, enabling integration with web frontends, webhooks, and other services. See the [REST API Documentation](https://docs.dexto.ai/api/rest/) for available endpoints.

### Session Management

Create and manage multiple conversation sessions with persistent storage.

```typescript
const agent = new DextoAgent(config);
await agent.start();

// Create and manage sessions
const session = await agent.createSession('user-123');
await agent.generate('Hello, how can you help me?', session.id);

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
await agent.switchLLM({ model: 'gpt-5-mini' });
await agent.switchLLM({ model: 'claude-sonnet-4-5-20250929' });

// Switch model for a specific session id 1234
await agent.switchLLM({ model: 'gpt-5-mini' }, '1234')

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

### Agent-to-Agent Delegation

Delegate tasks to other A2A-compliant agents using the built-in `delegate_to_url` tool.

```typescript
import { builtinToolsFactory } from '@dexto/tools-builtins';

const tools = builtinToolsFactory.create({
  type: 'builtin-tools',
  enabledTools: ['delegate_to_url'],
});

const agent = new DextoAgent({
  llm: { /* ... */ },
  logger,   // provide a per-agent logger instance
  storage,  // provide cache/database/blob implementations
  tools,
  permissions: { mode: 'auto-approve' }
});
await agent.start();

const session = await agent.createSession();

// Delegate via natural language
await agent.generate(`
  Please delegate this task to the PDF analyzer agent at http://localhost:3001:
  "Extract all tables from the Q4 sales report"
`, session.id);

// Or call the tool directly
await agent.executeTool('delegate_to_url', {
  url: 'http://localhost:3001',
  message: 'Extract all tables from the Q4 sales report',
});
```

**Configuration (YAML):**
```yaml
tools:
  - type: builtin-tools
    enabledTools:
      - delegate_to_url
```

**What it provides:**
- Point-to-point delegation when you know the agent URL
- A2A Protocol v0.3.0 compliant (JSON-RPC transport)
- Session management for stateful multi-turn conversations
- Automatic endpoint discovery (/v1/jsonrpc, /jsonrpc)
- Timeout handling and error recovery

**Use cases:**
- Multi-agent systems with known agent URLs
- Delegation to specialized agents
- Building agent workflows and pipelines
- Testing agent-to-agent communication

### Telemetry

Built-in OpenTelemetry distributed tracing for observability.

```typescript
const agent = new DextoAgent({
  llm: { /* ... */ },
  telemetry: {
    enabled: true,
    serviceName: 'my-agent',
    export: {
      type: 'otlp',
      endpoint: 'http://localhost:4318/v1/traces'
    }
  }
});
```

Automatically traces agent operations, LLM calls with token usage, and tool executions. See `src/telemetry/README.md` for details.

### Logger

Multi-transport logging system (v2) with console, file, and remote transports. Configure in agent YAML:

```yaml
logger:
  level: info  # error | warn | info | debug | silly
  transports:
    - type: console
      colorize: true
    - type: file
      path: ./logs/agent.log
      maxSize: 10485760
      maxFiles: 5
```

CLI automatically adds per-agent file transport at `~/.dexto/logs/<agent-id>.log`. See architecture in `src/logger/v2/`.

See the DextoAgent API reference for all methods:
https://docs.dexto.ai/api/dexto-agent/

---

## Links

- Docs: https://docs.dexto.ai/
- Configuration Guide: https://docs.dexto.ai/docs/category/guides/
- API Reference: https://docs.dexto.ai/api/

## License

Elastic License 2.0. See the repository LICENSE for details.
