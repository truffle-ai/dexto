---
sidebar_position: 1
---

# DextoAgent API

Complete API reference for the main `DextoAgent` class. This is the core interface for the Dexto Agent SDK.

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

The Dexto Agent SDK provides three methods for processing messages:
- **`generate()`** - Recommended for most use cases. Returns a complete response.
- **`stream()`** - For real-time streaming UIs. Yields events as they arrive.
- **`run()`** - Lower-level method for direct control.

### `generate`

**Recommended method** for processing user input. Waits for complete response.

```typescript
async generate(
  content: ContentInput,
  sessionId: string,
  options?: GenerateOptions
): Promise<GenerateResponse>
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `content` | `string \| ContentPart[]` | User message (string) or multimodal content (array) |
| `sessionId` | `string` | **Required.** Session ID for the conversation |
| `options.signal` | `AbortSignal` | (Optional) For cancellation |

**Content Types:**
```typescript
// Simple string content
type ContentInput = string | ContentPart[];

// For multimodal content, use ContentPart array:
type ContentPart = TextPart | ImagePart | FilePart;

interface TextPart { type: 'text'; text: string; }
interface ImagePart { type: 'image'; image: string; mimeType?: string; }
interface FilePart { type: 'file'; data: string; mimeType: string; filename?: string; }
```

**Returns:** `Promise<GenerateResponse>`
```typescript
interface GenerateResponse {
  content: string;           // The AI's text response
  reasoning?: string;        // Extended thinking (o1/o3 models)
  usage: TokenUsage;         // Token usage statistics
  toolCalls: AgentToolCall[]; // Tools that were called
  sessionId: string;
  messageId: string;
}
```

**Example:**
```typescript
const agent = new DextoAgent(config);
await agent.start();

const session = await agent.createSession();

// Simple text message
const response = await agent.generate('What is 2+2?', session.id);
console.log(response.content); // "4"
console.log(response.usage.totalTokens); // Token count

// With image URL (auto-detected)
const response = await agent.generate([
  { type: 'text', text: 'Describe this image' },
  { type: 'image', image: 'https://example.com/photo.jpg' }
], session.id);

// With image base64
const response = await agent.generate([
  { type: 'text', text: 'Describe this image' },
  { type: 'image', image: base64Image, mimeType: 'image/png' }
], session.id);

// With file URL
const response = await agent.generate([
  { type: 'text', text: 'Summarize this document' },
  { type: 'file', data: 'https://example.com/doc.pdf', mimeType: 'application/pdf' }
], session.id);

// With file base64
const response = await agent.generate([
  { type: 'text', text: 'Summarize this document' },
  { type: 'file', data: base64Pdf, mimeType: 'application/pdf', filename: 'doc.pdf' }
], session.id);

// With cancellation support
const controller = new AbortController();
const response = await agent.generate('Long task...', session.id, { signal: controller.signal });

await agent.stop();
```

### `stream`

For real-time streaming UIs. Yields events as they arrive.

```typescript
async stream(
  content: ContentInput,
  sessionId: string,
  options?: StreamOptions
): Promise<AsyncIterableIterator<StreamingEvent>>
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `content` | `string \| ContentPart[]` | User message (string) or multimodal content (array) |
| `sessionId` | `string` | **Required.** Session ID |
| `options.signal` | `AbortSignal` | (Optional) For cancellation |

**Returns:** `Promise<AsyncIterableIterator<StreamingEvent>>`

**Example:**
```typescript
const session = await agent.createSession();

// Simple text streaming
for await (const event of await agent.stream('Write a poem', session.id)) {
  if (event.name === 'llm:chunk') {
    process.stdout.write(event.content);
  }
  if (event.name === 'llm:tool-call') {
    console.log(`\n[Using ${event.toolName}]\n`);
  }
}

// Streaming with image
for await (const event of await agent.stream([
  { type: 'text', text: 'Describe this image' },
  { type: 'image', image: base64Image, mimeType: 'image/png' }
], session.id)) {
  if (event.name === 'llm:chunk') {
    process.stdout.write(event.content);
  }
}
```

### `run`

Lower-level method for direct control. Prefer `generate()` for most use cases.

```typescript
async run(
  textInput: string,
  imageDataInput: { image: string; mimeType: string } | undefined,
  fileDataInput: { data: string; mimeType: string; filename?: string } | undefined,
  sessionId: string,
  stream?: boolean
): Promise<string>
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `textInput` | `string` | User message or query |
| `imageDataInput` | `{ image: string; mimeType: string } \| undefined` | Image data or undefined |
| `fileDataInput` | `{ data: string; mimeType: string; filename?: string } \| undefined` | File data or undefined |
| `sessionId` | `string` | **Required.** Session ID |
| `stream` | `boolean` | (Optional) Enable streaming (default: false) |

**Returns:** `Promise<string>` - AI response text

**Example:**
```typescript
const agent = new DextoAgent(config);
await agent.start();

const session = await agent.createSession();

// Recommended: Use generate() for most use cases
const response = await agent.generate(
  "Explain quantum computing",
  session.id
);
console.log(response.content);

// Lower-level run() method (returns just the text)
const responseText = await agent.run(
  "Explain quantum computing",
  undefined,  // no image
  undefined,  // no file
  session.id
);

await agent.stop();
```

### `cancel`

Cancels the currently running turn for a session.

```typescript
async cancel(sessionId: string): Promise<boolean>
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `sessionId` | `string` | **Required.** Session ID to cancel |

**Returns:** `Promise<boolean>` - true if a run was in progress and cancelled

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
// Create a new session (auto-generated ID)
const session = await agent.createSession();
console.log(`Created session: ${session.id}`);

// Create a session with custom ID
const userSession = await agent.createSession('user-123');

// Use the session for conversations
await agent.generate("Hello!", session.id);
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
| `llmUpdates` | `LLMUpdates` | LLM configuration updates (model, provider, apiKey, etc.) |
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

### `addMcpServer`

Adds and connects to a new MCP server, making its tools available to the agent.

```typescript
async addMcpServer(name: string, config: McpServerConfig): Promise<void>
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | Server name |
| `config` | `McpServerConfig` | Server configuration |

### `removeMcpServer`

Disconnects from an MCP server and removes it completely from the agent.

```typescript
async removeMcpServer(name: string): Promise<void>
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | Server name to remove |

### `enableMcpServer`

Enables a disabled MCP server and connects it.

```typescript
async enableMcpServer(name: string): Promise<void>
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | Server name to enable |

### `disableMcpServer`

Disables an MCP server and disconnects it. The server remains registered but inactive.

```typescript
async disableMcpServer(name: string): Promise<void>
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | Server name to disable |

### `restartMcpServer`

Restarts an MCP server by disconnecting and reconnecting with its original configuration.

```typescript
async restartMcpServer(name: string): Promise<void>
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | Server name to restart |

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