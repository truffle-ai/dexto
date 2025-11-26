---
sidebar_position: 5
title: "Tools"
---

# Tools

Tools extend your agent's capabilities through the Model Context Protocol (MCP). Add filesystem access, web search, databases, APIs, and custom functionality to your agents.

## What You'll Learn

- Adding MCP servers to your agent
- Dynamic tool management
- Tool confirmation modes
- Building custom tools

## Adding MCP Servers

Configure MCP servers when creating your agent:

```typescript
import { DextoAgent } from '@dexto/core';

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
    },
    web_search: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'tavily-mcp'],
      env: { TAVILY_API_KEY: process.env.TAVILY_API_KEY }
    }
  }
});

await agent.start();
const session = await agent.createSession();

// Agent can now read files and search the web
const response = await agent.generate(
  'Search for recent AI news and save the summary to news.txt',
  { sessionId: session.id }
);
```

## Common MCP Servers

### Filesystem Access

```typescript
mcpServers: {
  filesystem: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/directory']
  }
}
```

Provides: read_file, write_file, list_directory, create_directory, search_files

### Web Search (Brave)

```typescript
mcpServers: {
  web_search: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    env: { BRAVE_API_KEY: process.env.BRAVE_API_KEY }
  }
}
```

Provides: brave_web_search, brave_local_search

### Web Search (Tavily)

```typescript
mcpServers: {
  tavily: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'tavily-mcp'],
    env: { TAVILY_API_KEY: process.env.TAVILY_API_KEY }
  }
}
```

Provides: tavily_search, tavily_extract

### GitHub

```typescript
mcpServers: {
  github: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN }
  }
}
```

Provides: create_issue, list_repositories, get_file_contents, search_code

### PostgreSQL

```typescript
mcpServers: {
  postgres: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    env: { DATABASE_URL: process.env.DATABASE_URL }
  }
}
```

Provides: query, list_tables, describe_table

## Dynamic Tool Management

Add and remove tools at runtime:

```typescript
const agent = new DextoAgent({
  llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: process.env.OPENAI_API_KEY }
});
await agent.start();

// Add a server at runtime
await agent.connectMcpServer('web_search', {
  type: 'stdio',
  command: 'npx',
  args: ['-y', 'tavily-mcp'],
  env: { TAVILY_API_KEY: process.env.TAVILY_API_KEY }
});

// Use it
const session = await agent.createSession();
await agent.generate('Search for latest TypeScript features', { sessionId: session.id });

// Remove it
await agent.removeMcpServer('web_search');
```

### Conditional Tools

Enable tools based on user permissions:

```typescript
class PermissionBasedAgent {
  private agent: DextoAgent;

  async initialize() {
    this.agent = new DextoAgent({
      llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: process.env.OPENAI_API_KEY }
    });
    await this.agent.start();
  }

  async setupUserTools(userId: string, permissions: string[]) {
    if (permissions.includes('filesystem')) {
      await this.agent.connectMcpServer('filesystem', {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', `/users/${userId}`]
      });
    }

    if (permissions.includes('database')) {
      await this.agent.connectMcpServer('postgres', {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-postgres'],
        env: { DATABASE_URL: process.env.DATABASE_URL }
      });
    }
  }

  async cleanupUserTools() {
    await this.agent.removeMcpServer('filesystem');
    await this.agent.removeMcpServer('postgres');
  }
}
```

## Listing Available Tools

Check what tools are available:

```typescript
// Get all tools from all servers
const tools = await agent.getAllTools();
console.log('Available tools:');
for (const [name, tool] of Object.entries(tools)) {
  console.log(`- ${name}: ${tool.description}`);
}

// Get tools from specific server
const fsTools = await agent.getMcpTools('filesystem');
console.log('Filesystem tools:', Object.keys(fsTools));
```

## Tool Confirmation

Control whether tools require approval before execution:

### Auto-Approve (Default)

Tools execute automatically without confirmation:

```typescript
const agent = new DextoAgent({
  llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: process.env.OPENAI_API_KEY },
  mcpServers: { /* servers */ }
  // toolConfirmation mode 'auto-approve' is the default
});
```

### Manual Approval

Require confirmation for each tool call:

```typescript
const agent = new DextoAgent({
  llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: process.env.OPENAI_API_KEY },
  toolConfirmation: { mode: 'manual' },
  mcpServers: { /* servers */ }
});

// Set up approval handler
agent.setApprovalCallback(async (toolName, args) => {
  console.log(`Agent wants to use: ${toolName}`);
  console.log('Arguments:', args);

  // Implement your approval logic
  return true; // or false to reject
});
```

### Selective Approval

Approve specific tools automatically:

```typescript
agent.setApprovalCallback(async (toolName, args) => {
  // Auto-approve safe read-only operations
  const autoApprove = ['read_file', 'list_directory', 'search_files'];
  if (autoApprove.includes(toolName)) {
    return true;
  }

  // Require manual approval for write operations
  console.log(`Approval needed for: ${toolName}`);
  // Show UI prompt to user
  return await promptUser(`Allow ${toolName}?`);
});
```

## Monitoring Tool Usage

Track tool execution with events:

```typescript
agent.agentEventBus.on('llm:tool-call', ({ toolName, args, sessionId }) => {
  console.log(`[${sessionId}] Calling: ${toolName}`);
  console.log('Arguments:', args);
});

agent.agentEventBus.on('llm:tool-result', ({ toolName, success, sanitized, sessionId }) => {
  if (success) {
    console.log(`[${sessionId}] ${toolName} succeeded`);
    console.log('Result:', sanitized);
  } else {
    console.error(`[${sessionId}] ${toolName} failed`);
  }
});
```

## Error Handling

Handle tool connection failures gracefully:

```typescript
const agent = new DextoAgent({
  llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: process.env.OPENAI_API_KEY },
  mcpServers: {
    filesystem: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '.'] },
    web_search: { type: 'stdio', command: 'npx', args: ['-y', 'tavily-mcp'], env: { TAVILY_API_KEY: process.env.TAVILY_API_KEY } }
  }
});

// Monitor connection status
agent.agentEventBus.on('mcp:server-connected', ({ name, success, error }) => {
  if (success) {
    console.log(`Connected to ${name}`);
  } else {
    console.warn(`Failed to connect to ${name}: ${error}`);
    // Agent will still work, just without this server
  }
});

await agent.start();
```

### Runtime Tool Failures

Handle individual tool execution failures:

```typescript
try {
  await agent.connectMcpServer('github', {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN }
  });
  console.log('GitHub tools available');
} catch (error) {
  console.error('Could not connect GitHub tools:', error.message);
  // Continue without GitHub functionality
}
```

## Building Custom MCP Servers

Create your own MCP server for custom functionality. Here's a simple example:

```typescript
// custom-tools-server.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new Server({
  name: 'custom-tools',
  version: '1.0.0'
}, {
  capabilities: {
    tools: {}
  }
});

// Register a tool
server.setRequestHandler('tools/list', async () => ({
  tools: [{
    name: 'get_weather',
    description: 'Get current weather for a location',
    inputSchema: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City name' }
      },
      required: ['location']
    }
  }]
}));

// Handle tool calls
server.setRequestHandler('tools/call', async (request) => {
  if (request.params.name === 'get_weather') {
    const { location } = request.params.arguments;
    // Implement weather API call
    return {
      content: [{
        type: 'text',
        text: `Weather in ${location}: Sunny, 72°F`
      }]
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

Use it in your agent:

```typescript
const agent = new DextoAgent({
  llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: process.env.OPENAI_API_KEY },
  mcpServers: {
    custom: {
      type: 'stdio',
      command: 'npx',
      args: ['tsx', './custom-tools-server.ts']
    }
  }
});
```

## Best Practices

### 1. Server Naming

Use clear, descriptive names:

```typescript
// Good
mcpServers: {
  filesystem_project: { /* config */ },
  filesystem_uploads: { /* config */ },
  web_search_tavily: { /* config */ }
}

// Avoid
mcpServers: {
  fs1: { /* config */ },
  fs2: { /* config */ }
}
```

### 2. Environment Variables

Keep credentials secure:

```typescript
mcpServers: {
  github: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: {
      GITHUB_TOKEN: process.env.GITHUB_TOKEN  // From .env file
    }
  }
}
```

### 3. Scope Filesystem Access

Limit filesystem tools to specific directories:

```typescript
mcpServers: {
  filesystem: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', './safe-directory']
    // Not './'. or '/'
  }
}
```

## Next Steps

- **[Events](./events.md)** - Monitor tool usage with the event system
- **[Error Handling](./error-handling.md)** - Handle tool failures gracefully
- **[MCP Guide](/docs/mcp/overview)** - Learn more about Model Context Protocol
