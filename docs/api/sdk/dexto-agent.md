---
sidebar_position: 1
---

# DextoAgent API

Complete API reference for the main `DextoAgent` class.

## Constructor and Lifecycle

### `constructor`

Creates a new Dexto agent instance with the provided configuration.

```typescript
constructor(config: AgentConfig)
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `config` | `AgentConfig` | Agent configuration object |

### `start`

Initializes and starts the agent with all required services.

```typescript
async start(): Promise<void>
```

**Parameters:** None

**Example:**
```typescript
const agent = new DextoAgent(config);
await agent.start();
```

### `stop`

Stops the agent and cleans up all resources.

```typescript
async stop(): Promise<void>
```

**Example:**
```typescript
await agent.stop();
```

---

## Core Methods

### `run`

Processes user input through the agent's LLM and returns the response.

```typescript
async run(
  textInput: string,
  imageDataInput?: { base64: string; mimeType: string },
  fileDataInput?: { base64: string; mimeType: string; filename?: string },
  sessionId?: string,
  stream?: boolean
): Promise<string | null>
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `textInput` | `string` | User message or query |
| `imageDataInput` | `{ base64: string; mimeType: string }` | (Optional) Base64-encoded image |
| `fileDataInput` | `{ base64: string; mimeType: string; filename?: string }` | (Optional) Base64-encoded file |
| `sessionId` | `string` | (Optional) Session ID |
| `stream` | `boolean` | (Optional) Enable streaming (default: false) |

**Returns:** `Promise<string | null>` - AI response or null

**Example:**
```typescript
const agent = new DextoAgent(config);
await agent.start();

// Create a session for the conversation
const session = await agent.createSession();

// Run with explicit session ID
const response = await agent.run(
  "Explain quantum computing",
  undefined,
  undefined,
  session.id
);

await agent.stop();
```

---

## Session Management

:::note Architectural Pattern
DextoAgent's core is **stateless** and does not track a "current" or "default" session. All session-specific operations require an explicit `sessionId` parameter. Application layers (CLI, WebUI, API servers) are responsible for managing which session is active in their own context.
:::

### `createSession`

Creates a new conversation session with optional custom ID.

```typescript
async createSession(sessionId?: string): Promise<ChatSession>
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `sessionId` | `string` | (Optional) Custom session ID |

**Returns:** `Promise<ChatSession>`

**Example:**
```typescript
// Create a new session
const session = await agent.createSession();
console.log(`Created session: ${session.id}`);

// Use the session for conversations
await agent.run("Hello!", undefined, undefined, session.id);
```

### `getSession`

Retrieves an existing session by its ID.

```typescript
async getSession(sessionId: string): Promise<ChatSession | undefined>
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `sessionId` | `string` | Session ID to retrieve |

**Returns:** `Promise<ChatSession | undefined>`

### `listSessions`

Returns an array of all active session IDs.

```typescript
async listSessions(): Promise<string[]>
```

**Returns:** `Promise<string[]>` - Array of session IDs

### `deleteSession`

Permanently deletes a session and all its conversation history. This action cannot be undone.

```typescript
async deleteSession(sessionId: string): Promise<void>
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `sessionId` | `string` | Session ID to delete |

**Note:** This completely removes the session and all associated conversation data from storage.

### `resetConversation`

Clears the conversation history of a session while keeping the session active.

```typescript
async resetConversation(sessionId: string): Promise<void>
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `sessionId` | `string` | Session ID to reset |

### `getSessionMetadata`

Retrieves metadata for a session including creation time and message count.

```typescript
async getSessionMetadata(sessionId: string): Promise<SessionMetadata | undefined>
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `sessionId` | `string` | Session ID |

**Returns:** `Promise<SessionMetadata | undefined>`

### `getSessionHistory`

Gets the complete conversation history for a session.

```typescript
async getSessionHistory(sessionId: string): Promise<ConversationHistory>
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `sessionId` | `string` | Session ID |

**Returns:** `Promise<ConversationHistory>`

---

## Configuration

### `switchLLM`

Dynamically changes the LLM configuration for the agent or a specific session.

```typescript
async switchLLM(
  llmUpdates: LLMUpdates,
  sessionId?: string
): Promise<ValidatedLLMConfig>
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `llmUpdates` | `LLMUpdates` | LLM configuration updates (model, provider, router, apiKey, etc.) |
| `sessionId` | `string` | (Optional) Target session ID |

**Returns:** `Promise<ValidatedLLMConfig>` – the fully validated, effective LLM configuration.

```typescript
const config = await agent.switchLLM({ 
  provider: 'anthropic', 
  model: 'claude-sonnet-4-5-20250929' 
});
console.log(config.model);
```

### `getCurrentLLMConfig`

Returns the base LLM configuration from the agent's initialization config.

```typescript
getCurrentLLMConfig(): LLMConfig
```

**Returns:** `LLMConfig` - The base LLM configuration (does not include session-specific overrides)

### `getEffectiveConfig`

Gets the complete effective configuration for a session or the default configuration.

```typescript
getEffectiveConfig(sessionId?: string): Readonly<AgentConfig>
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `sessionId` | `string` | (Optional) Session ID |

**Returns:** `Readonly<AgentConfig>`

---

## MCP Server Management

### `connectMcpServer`

Connects to a new MCP server and adds it to the agent's available tools.

```typescript
async connectMcpServer(name: string, config: McpServerConfig): Promise<void>
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | Server name |
| `config` | `McpServerConfig` | Server configuration |

### `removeMcpServer`

Disconnects from an MCP server and removes its tools from the agent.

```typescript
async removeMcpServer(name: string): Promise<void>
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | Server name to remove |

### `executeTool`

Executes a tool from any source (MCP servers, custom tools, or internal tools). This is the unified interface for tool execution.

```typescript
async executeTool(toolName: string, args: any): Promise<any>
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `toolName` | `string` | Tool name |
| `args` | `any` | Tool arguments |

**Returns:** `Promise<any>` - Tool execution result

### `getAllMcpTools`

Returns a map of all available tools from all connected MCP servers.

```typescript
async getAllMcpTools(): Promise<Record<string, ToolDefinition>>
```

**Returns:** `Promise<Record<string, ToolDefinition>>`

### `getAllTools`

Returns a map of all available tools from all sources (MCP servers, custom tools, and internal tools). This is the unified interface for tool discovery.

```typescript
async getAllTools(): Promise<Record<string, ToolDefinition>>
```

**Returns:** `Promise<Record<string, ToolDefinition>>`

### `getMcpClients`

Returns a map of all connected MCP client instances.

```typescript
getMcpClients(): Map<string, IMCPClient>
```

**Returns:** `Map<string, IMCPClient>`

### `getMcpFailedConnections`

Returns a record of failed MCP server connections and their error messages.

```typescript
getMcpFailedConnections(): Record<string, string>
```

**Returns:** `Record<string, string>` - Failed connection names to error messages 

---

## Model & Provider Introspection

### `getSupportedProviders`

Returns the list of supported LLM providers.

```typescript
getSupportedProviders(): LLMProvider[]
```

### `getSupportedModels`

Returns supported models grouped by provider, including a flag for the default model per provider.

```typescript
getSupportedModels(): Record<LLMProvider, Array<ModelInfo & { isDefault: boolean }>>
```

### `getSupportedModelsForProvider`

Returns supported models for a specific provider.

```typescript
getSupportedModelsForProvider(provider: LLMProvider): Array<ModelInfo & { isDefault: boolean }>
```

### `inferProviderFromModel`

Infers the provider from a model name or returns `null` if unknown.

```typescript
inferProviderFromModel(modelName: string): LLMProvider | null
```

---

## Search

### `searchMessages`

Search for messages across all sessions or within a specific session.

```typescript
async searchMessages(query: string, options?: SearchOptions): Promise<SearchResponse>
```

### `searchSessions`

Search for sessions that contain the specified query.

```typescript
async searchSessions(query: string): Promise<SessionSearchResponse>
```