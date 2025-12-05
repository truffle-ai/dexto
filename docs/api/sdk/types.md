---
sidebar_position: 4
---

# SDK Types for TypeScript

Type definitions and interfaces for the Dexto Agent SDK for TypeScript.

## Core Imports

```typescript
import {
  // Main classes
  DextoAgent,
  
  // Standalone utilities
  MCPManager,
  Logger,
  AgentEventBus,
  SessionEventBus,
  createStorageBackends,
  createAgentServices,
  
  // Configuration types
  AgentConfig,
  LLMConfig,
  McpServerConfig,
  StorageConfig,
  
  // Session types
  ChatSession,
  SessionMetadata,
  ConversationHistory,
  
  // Result types
  ValidatedLLMConfig,
  
  // Event types
  AgentEventMap,
  SessionEventMap,
  
  // Storage types
  StorageBackends,
  CacheBackend,
  DatabaseBackend,
  
  // Service types
  AgentServices,
} from '@dexto/core';
```

---

## Configuration Types

### `AgentConfig`

Main configuration object for creating Dexto agents.

```typescript
interface AgentConfig {
  llm: LLMConfig;
  mcpServers?: Record<string, McpServerConfig>;
  storage?: StorageConfig;
  sessions?: SessionConfig;
  systemPrompt?: string;
}
```

### `LLMConfig`

Configuration for Large Language Model providers.

```typescript
interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'google' | 'groq' | 'xai' | 'cohere' | 'openai-compatible';
  model: string;
  apiKey?: string;
  baseURL?: string;
  temperature?: number;
  maxOutputTokens?: number;
  maxInputTokens?: number;
  maxIterations?: number;
  systemPrompt?: string;
}
```

### `McpServerConfig`

Configuration for Model Context Protocol servers.

```typescript
interface McpServerConfig {
  type: 'stdio' | 'sse' | 'http';
  command?: string;       // Required for stdio
  args?: string[];        // For stdio
  env?: Record<string, string>;  // For stdio
  url?: string;           // Required for sse/http
  headers?: Record<string, string>;  // For sse/http
  timeout?: number;       // Default: 30000
  connectionMode?: 'strict' | 'lenient';  // Default: 'lenient'
}
```

### `StorageConfig`

Configuration for storage backends.

```typescript
interface StorageConfig {
  cache: CacheBackendConfig;
  database: DatabaseBackendConfig;
}

interface CacheBackendConfig {
  type: 'in-memory' | 'redis';
  url?: string;
  options?: Record<string, any>;
}

interface DatabaseBackendConfig {
  type: 'in-memory' | 'sqlite' | 'postgresql';
  url?: string;
  options?: Record<string, any>;
}
```

---

## Session Types

### `ChatSession`

Represents an individual conversation session.

```typescript
interface ChatSession {
  id: string;
  createdAt: Date;
  lastActivity: Date;
  
  // Session methods
  run(userInput: string, imageData?: ImageData): Promise<string>;
  getHistory(): Promise<ConversationHistory>;
  reset(): Promise<void>;
  getLLMService(): ILLMService;
}
```

### `SessionMetadata`

Metadata information about a session.

```typescript
interface SessionMetadata {
  id: string;
  createdAt: Date;
  lastActivity: Date;
  messageCount: number;
  tokenCount?: number;
}
```

### `ConversationHistory`

Complete conversation history for a session.

```typescript
interface ConversationHistory {
  sessionId: string;
  messages: ConversationMessage[];
  totalTokens?: number;
}

interface ConversationMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: Date;
  tokenCount?: number;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
}
```

---

## Result Types

### `ValidatedLLMConfig`

Validated LLM configuration returned by `switchLLM`.

```typescript
type ValidatedLLMConfig = LLMConfig & {
  maxInputTokens?: number;
};
```

---

## Event Types

:::info Event Naming Convention
All events use the `namespace:kebab-case` format. For detailed event documentation and usage examples, see the [Events Reference](./events.md).
:::

### `AgentEventMap`

Type map for agent-level events. All event names follow the `namespace:kebab-case` convention.

```typescript
interface AgentEventMap {
  // Session events
  'session:reset': {
    sessionId: string;
  };
  
  'session:created': {
    sessionId: string;
    switchTo: boolean; // Whether UI should switch to this session
  };
  
  'session:title-updated': {
    sessionId: string;
    title: string;
  };
  
  'session:override-set': {
    sessionId: string;
    override: SessionOverride;
  };
  
  'session:override-cleared': {
    sessionId: string;
  };
  
  // MCP server events
  'mcp:server-connected': {
    name: string;
    success: boolean;
    error?: string;
  };
  
  'mcp:server-added': {
    serverName: string;
    config: McpServerConfig;
  };
  
  'mcp:server-removed': {
    serverName: string;
  };
  
  'mcp:server-updated': {
    serverName: string;
    config: McpServerConfig;
  };
  
  'mcp:server-restarted': {
    serverName: string;
  };
  
  'mcp:resource-updated': {
    serverName: string;
    resourceUri: string;
  };
  
  'mcp:prompts-list-changed': {
    serverName: string;
    prompts: string[];
  };
  
  'mcp:tools-list-changed': {
    serverName: string;
    tools: string[];
  };
  
  'resource:cache-invalidated': {
    resourceUri?: string;
    serverName: string;
    action: 'updated' | 'server_connected' | 'server_removed' | 'blob_stored';
  };
  
  'tools:available-updated': {
    tools: string[];
    source: 'mcp' | 'builtin';
  };
  
  // Configuration events
  'llm:switched': {
    newConfig: ValidatedLLMConfig;
    historyRetained?: boolean;
    sessionIds: string[]; // Array of affected session IDs
  };
  
  'state:changed': {
    field: string;
    oldValue: any;
    newValue: any;
    sessionId?: string;
  };
  
  'state:exported': {
    config: AgentConfig;
  };
  
  'state:reset': {
    toConfig: AgentConfig;
  };
  
  // Approval events
  'approval:request': {
    approvalId: string;
    approvalType: 'tool_confirmation' | 'elicitation' | 'custom';
    sessionId?: string;
    timeout?: number;
    timestamp: Date;
    metadata: Record<string, any>;
  };
  
  'approval:response': {
    approvalId: string;
    status: 'approved' | 'denied' | 'cancelled';
    reason?: DenialReason;
    message?: string;
    sessionId?: string;
    data?: Record<string, any>;
  };
  
  // LLM service events (forwarded from sessions with sessionId)
  'llm:thinking': {
    sessionId: string;
  };
  
  'llm:response': {
    content: string;
    reasoning?: string;
    provider?: string;
    model?: string;
    tokenUsage?: {
      inputTokens?: number;
      outputTokens?: number;
      reasoningTokens?: number;
      totalTokens?: number;
    };
    sessionId: string;
  };
  
  'llm:chunk': {
    chunkType: 'text' | 'reasoning'; // Note: renamed from 'type' to avoid conflicts
    content: string;
    isComplete?: boolean;
    sessionId: string;
  };
  
  'llm:tool-call': {
    toolName: string;
    args: Record<string, any>;
    callId?: string;
    sessionId: string;
  };
  
  'llm:tool-result': {
    toolName: string;
    sanitized: SanitizedToolResult;
    rawResult?: unknown;
    callId?: string;
    success: boolean;
    sessionId: string;
  };
  
  'llm:error': {
    error: Error;
    context?: string;
    recoverable?: boolean;
    sessionId: string;
  };
  
  'llm:unsupported-input': {
    errors: string[];
    provider: LLMProvider;
    model?: string;
    fileType?: string;
    details?: any;
    sessionId: string;
  };
}
```

### `SessionEventMap`

Type map for session-level events. These events are emitted within individual chat sessions and are automatically forwarded to the `AgentEventBus` with a `sessionId` property.

```typescript
interface SessionEventMap {
  'llm:thinking': void;
  
  'llm:response': {
    content: string;
    reasoning?: string;
    provider?: string;
    model?: string;
    tokenUsage?: {
      inputTokens?: number;
      outputTokens?: number;
      reasoningTokens?: number;
      totalTokens?: number;
    };
  };

  'llm:chunk': {
    chunkType: 'text' | 'reasoning';
    content: string;
    isComplete?: boolean;
  };

  'llm:tool-call': {
    toolName: string;
    args: Record<string, any>;
    callId?: string;
  };

  'llm:tool-result': {
    toolName: string;
    sanitized: SanitizedToolResult;
    rawResult?: unknown;
    callId?: string;
    success: boolean;
  };

  'llm:error': {
    error: Error;
    context?: string;
    recoverable?: boolean;
  };

  'llm:switched': {
    newConfig: ValidatedLLMConfig;
    historyRetained?: boolean;
    sessionIds: string[];
  };
  
  'llm:unsupported-input': {
    errors: string[];
    provider: LLMProvider;
    model?: string;
    fileType?: string;
    details?: any;
  };
}
```

### Event Tier Types

```typescript
// Tier 1: Events exposed via DextoAgent.stream()
export type StreamingEventName = 
  | 'llm:thinking'
  | 'llm:chunk'
  | 'llm:response'
  | 'llm:tool-call'
  | 'llm:tool-result'
  | 'llm:error'
  | 'llm:unsupported-input'
  | 'approval:request'
  | 'approval:response'
  | 'session:title-updated';

// Tier 2: Events exposed via webhooks, A2A, and monitoring
export type IntegrationEventName = StreamingEventName
  | 'session:created'
  | 'session:reset'
  | 'mcp:server-connected'
  | 'mcp:server-restarted'
  | 'mcp:tools-list-changed'
  | 'mcp:prompts-list-changed'
  | 'tools:available-updated'
  | 'llm:switched'
  | 'state:changed';

// Union types with payloads
// Note: Uses 'name' (not 'type') to avoid collision with ApprovalRequest.type payload field
export type StreamingEvent = {
  [K in StreamingEventName]: { name: K } & AgentEventMap[K];
}[StreamingEventName];
```

---

## Storage Types

### `StorageBackends`

Container for storage backend instances.

```typescript
interface StorageBackends {
  cache: CacheBackend;
  database: DatabaseBackend;
}
```

### `CacheBackend`

Interface for cache storage operations.

```typescript
interface CacheBackend {
  get(key: string): Promise<any>;
  set(key: string, value: any, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  disconnect?(): Promise<void>;
}
```

### `DatabaseBackend`

Interface for database storage operations.

```typescript
interface DatabaseBackend {
  get(key: string): Promise<any>;
  set(key: string, value: any): Promise<void>;
  delete(key: string): Promise<void>;
  append(key: string, value: any): Promise<void>;
  getRange(key: string, start: number, end: number): Promise<any[]>;
  disconnect?(): Promise<void>;
}
```

---

## Service Types

### `AgentServices`

Container for all agent service instances.

```typescript
interface AgentServices {
  mcpManager: MCPManager;
  systemPromptManager: SystemPromptManager;
  agentEventBus: AgentEventBus;
  stateManager: AgentStateManager;
  sessionManager: SessionManager;
  storage: StorageBackends;
}
```

---

## Tool Types

### `ToolSet`

Map of tool names to tool definitions.

```typescript
type ToolSet = Record<string, ToolDefinition>;

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}
```

### `ToolCall`

Represents a tool execution request.

```typescript
interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}
```

### `ToolResult`

Represents a tool execution result.

```typescript
interface ToolResult {
  callId: string;
  toolName: string;
  result: any;
  success: boolean;
  error?: string;
}
```

---

## Utility Types

### `ImageData`

Type for image data in conversations.

```typescript
interface ImageData {
  base64: string; // Base64 encoded image
  mimeType: string; // e.g., 'image/jpeg', 'image/png'
}
```

### `FileData`

Type for file data in conversations.

```typescript
interface FileData {
  base64: string; // Base64 encoded file data
  mimeType: string; // e.g., 'application/pdf', 'audio/wav'
  filename?: string; // Optional filename
}
```

**Supported File Types:**
- **PDF files** (`application/pdf`) - Most widely supported
- **Audio files** (`audio/mp3`, `audio/wav`) - With OpenAI `gpt-4o-audio-preview` and Google Gemini models

**Unsupported File Types:**
- Text files (`.txt`, `.md`)
- CSV files (`.csv`)
- Word documents (`.doc`, `.docx`)
- Excel files (`.xls`, `.xlsx`)
- PowerPoint files (`.ppt`, `.pptx`)
- JSON files (`.json`)
- XML files (`.xml`)
- HTML files (`.html`)

For unsupported file types, consider:
1. Converting to text and sending as regular messages
2. Using specialized MCP servers for file processing
3. Using dedicated file processing tools

### `LoggerOptions`

Configuration options for the Logger class.

```typescript
interface LoggerOptions {
  level?: 'error' | 'warn' | 'info' | 'http' | 'verbose' | 'debug' | 'silly';
  silent?: boolean;
}
```

### `ChalkColor`

Available colors for logger output.

```typescript
type ChalkColor = 
  | 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white'
  | 'gray' | 'grey' | 'blackBright' | 'redBright' | 'greenBright' | 'yellowBright'
  | 'blueBright' | 'magentaBright' | 'cyanBright' | 'whiteBright';
```

---

## Generic Types

### `EventListener`

Generic event listener function type.

```typescript
type EventListener<T> = (data: T) => void;
```

### `EventEmitterOptions`

Options for event emitter methods.

```typescript
interface EventEmitterOptions {
  signal?: AbortSignal;
} 
