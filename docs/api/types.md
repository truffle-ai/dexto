---
sidebar_position: 4
---

# TypeScript Types

Type definitions and interfaces for the Saiki TypeScript/JavaScript SDK.

## Core Imports

```typescript
import {
  // Main classes
  SaikiAgent,
  
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
  SwitchLLMResult,
  
  // Event types
  AgentEventMap,
  SessionEventMap,
  
  // Storage types
  StorageBackends,
  CacheBackend,
  DatabaseBackend,
  
  // Service types
  AgentServices,
} from '@truffle-ai/saiki';
```

---

## Configuration Types

### `AgentConfig`

Main configuration object for creating Saiki agents.

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
  provider: 'openai' | 'anthropic' | 'groq' | 'google' | 'cohere';
  model: string;
  apiKey?: string;
  baseURL?: string;
  router?: 'vercel' | 'in-built';
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
  type: 'stdio' | 'sse' | 'websocket';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  apiKey?: string;
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

### `SwitchLLMResult`

Result object returned by LLM switching operations.

```typescript
interface SwitchLLMResult {
  success: boolean;
  config?: LLMConfig;
  message?: string;
  warnings?: string[];
  errors?: ValidationError[];
}

interface ValidationError {
  field: string;
  message: string;
  code: string;
}
```

---

## Event Types

### `AgentEventMap`

Type map for agent-level events.

```typescript
interface AgentEventMap {
  // Conversation events
  'saiki:conversationReset': {
    sessionId: string;
  };
  
  // MCP server events
  'saiki:mcpServerConnected': {
    name: string;
    success: boolean;
    error?: string;
  };
  
  'saiki:mcpServerAdded': {
    serverName: string;
    config: McpServerConfig;
  };
  
  'saiki:mcpServerRemoved': {
    serverName: string;
  };
  
  'saiki:mcpServerUpdated': {
    serverName: string;
    config: McpServerConfig;
  };
  
  'saiki:availableToolsUpdated': {
    tools: string[];
    source: 'mcp' | 'builtin';
  };
  
  // Configuration events
  'saiki:llmSwitched': {
    newConfig: LLMConfig;
    router?: string;
    historyRetained?: boolean;
    sessionIds: string[];
  };
  
  'saiki:stateChanged': {
    field: string;
    oldValue: any;
    newValue: any;
    sessionId?: string;
  };
  
  'saiki:stateExported': {
    config: AgentConfig;
  };
  
  'saiki:stateReset': {
    toConfig: AgentConfig;
  };
  
  // Session override events
  'saiki:sessionOverrideSet': {
    sessionId: string;
    override: SessionOverride;
  };
  
  'saiki:sessionOverrideCleared': {
    sessionId: string;
  };
  
  // LLM service events (forwarded from sessions)
  'llmservice:thinking': {
    sessionId: string;
  };
  
  'llmservice:response': {
    content: string;
    tokenCount?: number;
    model?: string;
    sessionId: string;
  };
  
  'llmservice:chunk': {
    content: string;
    isComplete?: boolean;
    sessionId: string;
  };
  
  'llmservice:toolCall': {
    toolName: string;
    args: Record<string, any>;
    callId?: string;
    sessionId: string;
  };
  
  'llmservice:toolResult': {
    toolName: string;
    result: any;
    callId?: string;
    success: boolean;
    sessionId: string;
  };
  
  'llmservice:error': {
    error: Error;
    context?: string;
    recoverable?: boolean;
    sessionId: string;
  };
  
  'llmservice:switched': {
    newConfig: LLMConfig;
    router?: string;
    historyRetained?: boolean;
    sessionId: string;
  };
}
```

### `SessionEventMap`

Type map for session-level events.

```typescript
interface SessionEventMap {
  'llmservice:thinking': void;
  
  'llmservice:response': {
    content: string;
    tokenCount?: number;
    model?: string;
  };
  
  'llmservice:chunk': {
    content: string;
    isComplete?: boolean;
  };
  
  'llmservice:toolCall': {
    toolName: string;
    args: Record<string, any>;
    callId?: string;
  };
  
  'llmservice:toolResult': {
    toolName: string;
    result: any;
    callId?: string;
    success: boolean;
  };
  
  'llmservice:error': {
    error: Error;
    context?: string;
    recoverable?: boolean;
  };
  
  'llmservice:switched': {
    newConfig: LLMConfig;
    router?: string;
    historyRetained?: boolean;
  };
}
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
  promptManager: PromptManager;
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
  image: string; // Base64 encoded image
  mimeType: string; // e.g., 'image/jpeg', 'image/png'
}
```

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
``` 