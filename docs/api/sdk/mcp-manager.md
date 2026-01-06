---
sidebar_position: 2
title: "MCPManager"
---

# MCPManager

The `MCPManager` is a powerful, standalone utility for managing [Model Context Protocol (MCP)](/docs/mcp/overview) servers. It allows you to connect, manage, and interact with multiple MCP servers in your own applications without needing the full Dexto agent framework.

This class provides a unified interface for accessing tools, resources, and prompts from all connected servers, making it an essential component for building complex, multi-server workflows.

## Constructor

```typescript
constructor(confirmationProvider?: ToolConfirmationProvider)
```

Creates a new `MCPManager` instance for managing MCP server connections.

**Parameters:**
- `confirmationProvider` (optional): A custom tool confirmation provider. If not provided, a default CLI-based confirmation is used.

**Example:**
```typescript
import { MCPManager } from '@dexto/core';

// Basic manager
const manager = new MCPManager();

// With a custom confirmation provider
const customProvider = new CustomConfirmationProvider();
const managerWithProvider = new MCPManager(customProvider);
```

## Connection Management Methods

#### `connectServer`

Connects to a new MCP server.

```typescript
async connectServer(name: string, config: McpServerConfig): Promise<void>
```

**Parameters:**
- `name`: Unique identifier for the server connection
- `config`: Server configuration object

**Server Configuration Types:**

```typescript
// stdio server (most common)
{
  type: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
  env?: { [key: string]: string }
}

// HTTP server (recommended for remote)
{
  type: 'http',
  url: 'http://localhost:3001/mcp',
  headers?: { [key: string]: string },
  timeout?: number,
  connectionMode?: 'strict' | 'lenient'
}

// SSE (Server-Sent Events) server - DEPRECATED, use http instead
{
  type: 'sse',
  url: 'http://localhost:3001/sse',
  headers?: { [key: string]: string },
  timeout?: number,
  connectionMode?: 'strict' | 'lenient'
}
```

**Examples:**

```typescript
// File system server
await manager.connectServer('filesystem', {
  type: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '.']
});

// Web search server with API key
await manager.connectServer('tavily-search', {
  type: 'stdio',
  command: 'npx', 
  args: ['-y', 'tavily-mcp@0.1.2'],
  env: {
    TAVILY_API_KEY: process.env.TAVILY_API_KEY
  }
});

// HTTP MCP server
await manager.connectServer('remote-agent', {
  type: 'http',
  baseUrl: 'http://localhost:3001/mcp',
  timeout: 30000
});
```

#### `initializeFromConfig`

Initialize multiple servers from configuration.

```typescript
async initializeFromConfig(
  serverConfigs: ServerConfigs, 
  connectionMode: 'strict' | 'lenient' = 'lenient'
): Promise<void>
```

**Parameters:**
- `serverConfigs`: Object mapping server names to configurations
- `connectionMode`: 
  - `'strict'`: All servers must connect successfully
  - `'lenient'`: At least one server must connect successfully

**Example:**
```typescript
const serverConfigs = {
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
  }
};

await manager.initializeFromConfig(serverConfigs, 'lenient');
```

#### `removeClient`

Disconnects and removes a specific MCP server.

```typescript
async removeClient(name: string): Promise<void>
```

**Example:**
```typescript
await manager.removeClient('filesystem');
```

#### `disconnectAll`

Disconnect all servers and clear caches.

```typescript
async disconnectAll(): Promise<void>
```

**Example:**
```typescript
await manager.disconnectAll();
```

#### `restartServer`

Restart a specific MCP server by disconnecting and reconnecting with its original configuration.

```typescript
async restartServer(name: string): Promise<void>
```

**Parameters:**
- `name`: The name of the server to restart

**Example:**
```typescript
// Restart a server after it becomes unresponsive
await manager.restartServer('filesystem');
```

#### `refresh`

Refresh all tool, resource, and prompt caches from connected servers.

```typescript
async refresh(): Promise<void>
```

**Example:**
```typescript
// Force refresh all caches after external changes
await manager.refresh();
```

## Tool Management Methods

#### `getAllTools`

Gets all available tools from connected servers.

```typescript
async getAllTools(): Promise<ToolSet>
```

**Returns:** Object mapping tool names to tool definitions

**Example:**
```typescript
const tools = await manager.getAllTools();
console.log('Available tools:', Object.keys(tools));

// Inspect a specific tool
const readFileTool = tools.readFile;
console.log('Tool schema:', readFileTool.inputSchema);
```

#### `getToolClient`

Get the client that provides a specific tool.

```typescript
getToolClient(toolName: string): IMCPClient | undefined
```

#### `executeTool`

Executes a specific tool with arguments.

```typescript
async executeTool(toolName: string, args: any): Promise<any>
```

**Example:**
```typescript
// Read a file
const content = await manager.executeTool('readFile', { 
  path: './package.json' 
});

// Search the web
const searchResults = await manager.executeTool('search', {
  query: 'latest AI developments',
  max_results: 5
});

// Write a file
await manager.executeTool('writeFile', {
  path: './output.txt',
  content: 'Hello from MCP!'
});
```

## Resource Management Methods

#### `listAllResources`

Gets all cached MCP resources from connected servers.

```typescript
async listAllResources(): Promise<MCPResolvedResource[]>
```

**Returns:** Array of resolved resources with metadata:

```typescript
interface MCPResolvedResource {
  key: string;        // Qualified resource key
  serverName: string; // Server that provides this resource
  summary: MCPResourceSummary;
}
```

#### `getResource`

Get cached resource metadata by qualified key.

```typescript
getResource(resourceKey: string): MCPResolvedResource | undefined
```

#### `readResource`

Reads a specific resource by URI.

```typescript
async readResource(uri: string): Promise<ReadResourceResult>
```

**Example:**
```typescript
const resource = await manager.readResource('file:///project/README.md');
console.log('Resource content:', resource.contents);
```

## Prompt Management Methods

#### `listAllPrompts`

Gets all available prompt names from connected servers.

```typescript
async listAllPrompts(): Promise<string[]>
```

#### `getPromptClient`

Get the client that provides a specific prompt.

```typescript
getPromptClient(promptName: string): IMCPClient | undefined
```

#### `getPrompt`

Gets a specific prompt by name.

```typescript
async getPrompt(name: string, args?: any): Promise<GetPromptResult>
```

**Example:**
```typescript
const prompt = await manager.getPrompt('code-review', {
  language: 'typescript',
  file: 'src/index.ts'
});
console.log('Prompt:', prompt.messages);
```

#### `getPromptMetadata`

Get cached metadata for a specific prompt (no network calls).

```typescript
getPromptMetadata(promptName: string): PromptDefinition | undefined
```

#### `getAllPromptMetadata`

Get all cached prompt metadata (no network calls).

```typescript
getAllPromptMetadata(): Array<{
  promptName: string;
  serverName: string;
  definition: PromptDefinition;
}>
```

## Status and Monitoring Methods

#### `getClients`

Returns all registered MCP client instances.

```typescript
getClients(): Map<string, IMCPClient>
```

**Example:**
```typescript
const clients = manager.getClients();
console.log('Connected servers:', Array.from(clients.keys()));

for (const [name, client] of clients) {
  console.log(`Server: ${name}, Tools available: ${Object.keys(await client.getTools()).length}`);
}
```

#### `getFailedConnections`

Returns failed connection error messages.

```typescript
getFailedConnections(): Record<string, string>
```

**Example:**
```typescript
const errors = manager.getFailedConnections();
if (Object.keys(errors).length > 0) {
  console.log('Failed connections:', errors);
}
```

### Complete Example

```typescript
import { MCPManager } from '@dexto/core';

const manager = new MCPManager();

// Connect to servers
await manager.connectServer('filesystem', {
  type: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '.']
});

// Execute tools directly
const result = await manager.executeTool('readFile', { path: './README.md' });
console.log('Read file result:', result);

// Get all available tools
const tools = await manager.getAllTools();
console.log('Available tools:', Object.keys(tools));

// Clean up
await manager.disconnectAll();
``` 