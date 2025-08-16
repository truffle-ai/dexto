---
sidebar_position: 6
---

# MCP Manager

The MCPManager is Dexto's powerful standalone utility for managing Model Context Protocol (MCP) servers. Use it in your own applications to connect, manage, and interact with multiple MCP servers without needing the full Dexto agent framework.

## Overview

The MCPManager provides:
- **Multi-server management**: Connect to multiple MCP servers simultaneously
- **Unified tool interface**: Access tools from all connected servers
- **Resource management**: Handle MCP resources and prompts
- **Connection pooling**: Automatic connection management and error handling
- **Type safety**: Full TypeScript support with comprehensive types

## Installation

```bash
npm install dexto
```

## Quick Start

```typescript
import { MCPManager } from 'dexto';

// Create manager instance
const manager = new MCPManager();

// Connect to an MCP server
await manager.connectServer('filesystem', {
  type: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '.']
});

// Get available tools
const tools = await manager.getAllTools();
console.log('Available tools:', Object.keys(tools));

// Execute a tool
const result = await manager.executeTool('readFile', { path: './README.md' });
console.log(result);
```

## Core Concepts

### MCP Servers

MCP servers are external processes that provide tools, resources, and prompts. Common types include:

- **File system servers**: Read/write files and directories
- **Web search servers**: Search the internet for information
- **Database servers**: Query and manage databases
- **API servers**: Interact with external APIs
- **Custom servers**: Your own domain-specific tools

### Connection Types

MCPManager supports three connection types:

- **`stdio`**: Most common, spawns a child process (e.g., Node.js packages)
- **`http`**: Connect to HTTP-based MCP servers
- **`sse`**: Server-sent events for real-time communication

### Tool Execution

Tools are functions provided by MCP servers. The manager:
1. Discovers all available tools from connected servers
2. Routes tool calls to the appropriate server
3. Handles confirmation prompts for sensitive operations
4. Returns structured results

## Common Usage Patterns

### File Operations

Perfect for automating file system tasks:

```typescript
const manager = new MCPManager();

await manager.connectServer('fs', {
  type: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '.']
});

// Read files
const packageJson = await manager.executeTool('readFile', { 
  path: './package.json' 
});

// List directory contents
const files = await manager.executeTool('listFiles', { 
  path: './src' 
});

// Write files
await manager.executeTool('writeFile', {
  path: './output.md',
  content: '# Generated Report\n\nSome content here...'
});
```

### Web Research

Integrate web search capabilities:

```typescript
await manager.connectServer('search', {
  type: 'stdio',
  command: 'npx',
  args: ['-y', 'tavily-mcp@0.1.2'],
  env: { TAVILY_API_KEY: process.env.TAVILY_API_KEY }
});

const results = await manager.executeTool('search', {
  query: 'Model Context Protocol specifications',
  max_results: 10
});
```

### Multi-Server Workflows

Combine multiple servers for complex tasks:

```typescript
// Initialize multiple servers at once
await manager.initializeFromConfig({
  filesystem: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '.']
  },
  search: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'tavily-mcp@0.1.2'],
    env: { TAVILY_API_KEY: process.env.TAVILY_API_KEY }
  },
  git: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@cyanheads/git-mcp-server'],
    env: {
        MCP_LOG_LEVEL: "info",
        GIT_SIGN_COMMITS: "false"
  }
});

// Complex workflow using multiple tools
async function generateProjectReport() {
  const files = await manager.executeTool('listFiles', { path: './src' });
  const commits = await manager.executeTool('git_log', { limit: 10 });
  const research = await manager.executeTool('search', {
    query: 'project documentation best practices'
  });
  
  const report = `# Project Report
Files: ${files.length}
Recent commits: ${commits.length}
Research findings: ${research.length}`;
  
  await manager.executeTool('writeFile', {
    path: './PROJECT_REPORT.md',
    content: report
  });
}
```

## Integration Examples

### Express.js API

Create an API that exposes MCP tools:

```typescript
import express from 'express';
import { MCPManager } from 'dexto';

const app = express();
app.use(express.json());

const manager = new MCPManager();
await manager.initializeFromConfig({
  filesystem: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '.']
  }
});

app.get('/api/tools', async (req, res) => {
  const tools = await manager.getAllTools();
  res.json({ tools: Object.keys(tools) });
});

app.post('/api/execute/:toolName', async (req, res) => {
  try {
    const { toolName } = req.params;
    const { args } = req.body;
    
    const result = await manager.executeTool(toolName, args);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.listen(3000);
```

For detailed API reference, see the [MCPManager API documentation](/api/mcp-manager). 🛠️

**Tool execution failures**
- Validate tool arguments match expected schema
- Check server logs for detailed error information 