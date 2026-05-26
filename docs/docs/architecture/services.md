# Core Services

import ExpandableMermaid from '@site/src/components/ExpandableMermaid';

Dexto's architecture is built around core services that handle different aspects of agent functionality. Understanding these services helps with debugging, customization, and troubleshooting.

## Service Overview

| Service | Purpose | Key Responsibilities |
|---------|---------|---------------------|
| **DextoAgent** | Main orchestrator | Coordinates all services, handles user interactions |
| **MCPManager** | Tool coordination | Connects to MCP servers, manages tools and resources |
| **ToolManager** | Tool execution | Executes tools, handles confirmations, manages internal tools |
| **SessionManager** | Conversation state | Manages chat sessions, conversation history |
| **DextoStores** | Data persistence | Provides typed stores for conversations, sessions, memory, artifacts, tools, workspaces, and runtime state |
| **SystemPromptManager** | System prompts | Manages system prompt assembly and dynamic content |
| **PromptManager** | Prompts | Manages prompt-only slash commands and MCP prompt templates |
| **SkillManager** | Skills | Lists and reads first-class skills for tools, CLI commands, and API catalog endpoints |
| **AgentEventBus** | Event coordination | Handles inter-service communication |

## Service Relationships

<ExpandableMermaid title="Service Relationships Diagram">
```mermaid
graph TB
    DA[DextoAgent] --> SM[SessionManager]
    DA --> MM[MCPManager]
    DA --> TM[ToolManager]
    DA --> SPM[SystemPromptManager]
    DA --> PM[PromptManager]
    DA --> SK[SkillManager]
    DA --> DS[DextoStores]
    DA --> AEB[AgentEventBus]

    MM --> TM
    TM --> DS
    SM --> DS
    SPM --> DS
    PM --> DS
    SK --> DS

    subgraph "Typed Store Layer"
        DS
        Conversation[(ConversationStore)]
        Sessions[(SessionStore)]
        Artifacts[(ArtifactStore)]
        Workspaces[(WorkspaceStore)]
    end

    DS --> Conversation
    DS --> Sessions
    DS --> Artifacts
    DS --> Workspaces

    AEB -.-> SM
    AEB -.-> MM
    AEB -.-> TM
```
</ExpandableMermaid>

## DextoAgent

**Main orchestrator** that coordinates all other services.

### Key Methods
- `start()` - Initialize all services
- `generate(message, options)` - Execute user prompt (recommended)
- `run(prompt, imageData?, fileData?, sessionId)` - Lower-level execution
- `switchLLM(updates)` - Change LLM model/provider
- `createSession(sessionId?)` - Create new chat session
- `stop()` - Shutdown all services

### Usage Example
```typescript
const agent = new DextoAgent(config);
await agent.start();

// Create a session
const session = await agent.createSession();

// Run a task
const response = await agent.generate("List files in current directory", session.id);
console.log(response.content);

// Switch models
await agent.switchLLM({ model: "claude-sonnet-4-5-20250929" });

await agent.stop();
```

## MCPManager

**Tool coordination** service that connects to Model Context Protocol servers.

### Key Methods
- `connectServer(name, config)` - Connect to MCP server
- `disconnectServer(name)` - Disconnect server
- `getAllTools()` - Get all available tools
- `executeTool(name, params)` - Execute specific tool

### Server Types
- **stdio** - Command-line programs
- **http** - HTTP REST endpoints  
- **sse** - Server-sent events

### Usage Example
```typescript
// Connect filesystem tools
await agent.mcpManager.connectServer('filesystem', {
  type: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '.']
});

// Get available tools
const tools = await agent.mcpManager.getAllTools();
```

## ToolManager

**Tool execution** service that handles tool calls and approvals.

### Key Methods
- `getToolStats()` - Get tool counts (MCP + internal)
- `getAllTools()` - Get all available tools
- `executeTool(call)` - Execute tool with approval

### Tool Approval
Controls when users are prompted to approve tool execution:
- **auto** - Smart approval based on tool risk
- **always** - Always ask for approval
- **never** - Never ask (auto-approve)

### Usage Example
```typescript
// Get tool statistics
const stats = await agent.toolManager.getToolStats();
console.log(`${stats.total} tools: ${stats.mcp} MCP, ${stats.internal} internal`);
```

## SessionManager

**Conversation state** management for persistent chat sessions.

### Key Methods
- `createSession(sessionId?)` - Create new session
- `getSession(sessionId)` - Retrieve existing session
- `listSessions()` - List all sessions
- `deleteSession(sessionId)` - Delete session
- `getSessionHistory(sessionId)` - Get conversation history
- `resetConversation(sessionId)` - Clear session history while keeping session active

### Session Features
- Persistent conversation history
- Session metadata (creation time, last activity)
- Cross-session search capabilities
- Export/import functionality

### Usage Example
```typescript
// Create new session
const session = await agent.createSession('work-session');

// List all sessions
const sessions = await agent.listSessions();

// Get conversation history
const history = await agent.getSessionHistory('work-session');

// Use session in conversations
const response = await agent.generate("Hello", session.id);
console.log(response.content);
```

## DextoStores

**Data persistence** through typed domain stores.

Core services depend on narrow stores such as `ConversationStore`, `SessionStore`, `MemoryStore`,
`ArtifactStore`, `WorkspaceStore`, and `ToolStateStore`. Core consumes only these typed stores.
Images own the runtime storage implementation and expose it with one
`storage.createStores(config.storage, logger, context)` call.

Hosts can use the local image for filesystem-backed local stores or inject hosted store
implementations for server/cloud runtimes. Core does not know whether a store is backed by
SQLite, Postgres, Durable Objects, object storage, or memory.

### Usage Pattern
```ts
const services = await resolveServicesFromConfig(config, image, hostContext);
const agent = new DextoAgent(toDextoAgentOptions({ config, services, image, hostContext }));
```

## PromptManager

**Prompt-only** slash commands and MCP prompt templates.

Prompts are user-invoked templates. They can come from agent config, command markdown files, custom
prompt storage, or connected MCP servers. They are not skills, and they are not auto-invoked by the
model as capabilities.

### Usage Example
```yaml
prompts:
  - type: inline
    id: quick-start
    prompt: "Show me what you can do and how to work with you"
    showInStarters: true
```

## SkillManager

**First-class skill catalog** for agent capabilities.

Skills are discovered from skill sources, exposed through `agent.skillManager`, and used by
`read_skill` / `invoke_skill` tools when enabled. They are listed separately from prompts in the
CLI with `/skills` and through the server catalog API at `GET /api/skills` and
`GET /api/skills/{id}`.

Skills are not prompt templates. Do not add skills to `prompts`; put them in skill directories or
provide a `SkillSource` through the active image.

## SystemPromptManager

**System prompt** assembly from multiple contributors.

### Contributor Types
- **static** - Fixed text content
- **dynamic** - Generated content (e.g., current date/time)  
- **file** - Content from files (.md, .txt)

### Priority System
Lower numbers execute first (0 = highest priority).

### Usage Example
```yaml
systemPrompt:
  contributors:
    - id: primary
      type: static
      priority: 0
      content: "You are a helpful AI assistant..."
    - id: date
      type: dynamic
      priority: 10
      source: date
    - id: context
      type: file
      priority: 5
      files: ["./docs/context.md"]
```

## AgentEventBus

**Event coordination** for inter-service communication.

### Event Types
- **llm:thinking** - AI is processing
- **llm:chunk** - Streaming response chunk
- **llm:tool-call** - Tool execution starting
- **llm:tool-result** - Tool execution completed
- **llm:response** - Final response ready

### Usage Example
```typescript
agent.on('llm:tool-call', (event) => {
  console.log(`Executing tool: ${event.toolName}`);
});

agent.on('llm:response', (event) => {
  console.log(`Response: ${event.content}`);
});
```

## Service Initialization

Services are initialized automatically when `DextoAgent.start()` is called:

1. **Stores** - Typed store connection
2. **Events** - Event bus setup
3. **Prompts and skills** - PromptManager and SkillManager setup
4. **System prompt** - Contributor assembly
5. **MCP** - Server connections
6. **Tools** - Tool discovery and validation
7. **Sessions** - Session management ready

## Debugging Services

### Log Levels
```bash
# Enable debug logging
DEXTO_LOG_LEVEL=debug dexto

# Service-specific debugging
DEXTO_LOG_LEVEL=silly dexto  # Most verbose
```

### Service Health Checks
```typescript
// Check MCP connections
const connectedServers = agent.mcpManager.getClients();
const failedConnections = agent.mcpManager.getFailedConnections();

// Check tool availability
const toolStats = await agent.toolManager.getToolStats();

// Inspect a typed store directly when debugging
const sessions = await agent.services.stores.getStore('sessions').listSessionIds();
```

### Common Issues
- **MCP connection failures** - Check command paths, network access
- **Store errors** - Verify the active image or host injected a connected `DextoStores`
- **Tool execution timeouts** - Increase timeout in server config
- **Session persistence issues** - Check the active session and conversation stores

## Service Configuration

Each service can be configured through the agent config:

```yaml
# MCP server connections
mcpServers:
  filesystem:
    type: stdio
    command: npx
    timeout: 30000

# Store configuration for the active image
storage:
  cache:
    type: redis
  database:
    type: postgres

# Session limits
sessions:
  maxSessions: 100
  sessionTTL: 3600000

# Permissions
permissions:
  mode: auto
  timeout: 30000
```

See [Configuration Guide](../guides/configuring-dexto/overview.md) for complete config options.
