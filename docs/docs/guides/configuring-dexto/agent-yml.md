---
title: Complete agent.yml
sidebar_position: 2
sidebar_label: "Complete agent.yml"
---
# agent.yml – Comprehensive Configuration Reference

This guide provides a complete reference for all configuration options available in `agent.yml`. The agent configuration file is the primary way to customize your Dexto agent's behavior, capabilities, and integrations.

## Table of Contents

1. [Overview](#overview)
2. [Complete Configuration Example](#complete-configuration-example)
3. [LLM Configuration](#llm-configuration)
4. [System Prompt Configuration](#system-prompt-configuration)
5. [MCP Servers](#mcp-servers)
6. [Tool Confirmation](#tool-confirmation)
7. [Storage Configuration](#storage-configuration)
8. [Session Configuration](#session-configuration)
9. [Telemetry Configuration](#telemetry-configuration)
10. [Plugins](#plugins)
11. [Internal Tools](#internal-tools)
12. [Internal Resources](#internal-resources)
13. [Agent Identity / A2A](#agent-identity--a2a)
14. [Dynamic Changes](#dynamic-changes)
15. [Global Preferences](#global-preferences)
16. [Starter Prompts](#starter-prompts)
17. [Greeting](#greeting)

## Overview

Below is a **minimal** configuration file to get started:

```yaml
systemPrompt: |
  You are a helpful AI assistant.

llm:
  provider: anthropic
  model: claude-sonnet-4-5-20250929
  apiKey: $ANTHROPIC_API_KEY
```

## Complete Configuration Example

Here's a comprehensive example combining all sections:

```yaml
# Overview (minimal example)
systemPrompt: |
  You are a helpful AI assistant with access to tools.

llm:
  provider: openai
  model: gpt-5
  apiKey: $OPENAI_API_KEY
  maxIterations: 50
  router: vercel

# System Prompt (advanced with contributors)
systemPrompt:
  contributors:
    - id: primary
      type: static
      priority: 0
      content: |
        You are a helpful AI assistant with access to tools.
    - id: dateTime
      type: dynamic
      priority: 10
      source: dateTime
    - id: memories
      type: memory
      priority: 40
      enabled: true
      options:
        includeTags: true
        limit: 10

# MCP Servers
mcpServers:
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
  playwright:
    type: stdio
    command: npx
    args: ["-y", "@playwright/mcp@latest"]

# Tool Confirmation
toolConfirmation:
  mode: event-based
  timeout: 120000
  allowedToolsStorage: storage
  toolPolicies:
    alwaysAllow:
      - internal--ask_user
      - mcp--filesystem--read_file

# Storage
storage:
  cache:
    type: in-memory
  database:
    type: sqlite
  blob:
    type: local
    maxBlobSize: 52428800
    maxTotalSize: 1073741824
    cleanupAfterDays: 30

# Sessions
sessions:
  maxSessions: 100
  sessionTTL: 3600000

# Telemetry
telemetry:
  enabled: true
  serviceName: my-dexto-agent
  tracerName: dexto-tracer
  export:
    type: otlp
    protocol: http
    endpoint: http://localhost:4318/v1/traces

# Plugins
plugins:
  contentPolicy:
    priority: 10
    blocking: true
    enabled: true
  responseSanitizer:
    priority: 900
    blocking: false
    enabled: true

# Internal Tools
internalTools:
  - ask_user
  - read_file
  - write_file
  - edit_file
  - glob_files
  - grep_content
  - bash_exec

# Internal Resources
internalResources:
  resources:
    - type: filesystem
      paths: ["."]
      maxFiles: 50
      maxDepth: 3
      includeExtensions: [".txt", ".md", ".json", ".yaml", ".js", ".ts", ".py"]
    - type: blob

# Agent Identity / A2A
agentCard:
  name: "MyAgent"
  description: "A comprehensive AI assistant"
  url: "https://agent.example.com"
  version: "1.0.0"
  provider:
    organization: "My Organization"
    url: "https://example.com"
  capabilities:
    streaming: true
    pushNotifications: false

# Starter Prompts
starterPrompts:
  - id: quick-start
    title: "📚 Quick Start"
    prompt: "Show me what you can do!"
    category: learning
    priority: 9

# Greeting
greeting: "Hello! I'm ready to help you today."
```

## LLM Configuration

Configure the language model provider and settings.

:::info Supported Providers & Models
For a complete list of supported providers, available models, and provider-specific features, see **[Supported LLM Providers](../supported-llm-providers.md)**.
:::

### Schema

```yaml
llm:
  provider: string              # Required: openai | anthropic | google | groq | openai-compatible
  model: string                 # Required: Model identifier
  apiKey: string                # Required: API key or $ENV_VAR reference
  maxIterations: number         # Optional: Max agentic loops (default: 50)
  router: string                # Optional: vercel | in-built (default: vercel)
  baseURL: string               # Optional: Custom base URL (provider-dependent)
  maxInputTokens: number        # Optional: Override max input tokens
  maxOutputTokens: number       # Optional: Override max output tokens
  temperature: number           # Optional: 0.0-1.0 (default varies by provider)
```

### Examples

#### OpenAI

```yaml
llm:
  provider: openai
  model: gpt-5
  apiKey: $OPENAI_API_KEY
  maxIterations: 50
  router: vercel
  temperature: 0.7
```

#### Anthropic (Claude)

```yaml
llm:
  provider: anthropic
  model: claude-sonnet-4-5-20250929
  apiKey: $ANTHROPIC_API_KEY
  maxInputTokens: 100000
```

#### Google Gemini

```yaml
llm:
  provider: google
  model: gemini-2.5-pro
  apiKey: $GOOGLE_GENERATIVE_AI_API_KEY
```

#### OpenAI-Compatible Provider

```yaml
llm:
  provider: openai-compatible
  model: custom-model-name
  apiKey: $CUSTOM_API_KEY
  baseURL: https://api.custom-provider.com/v1
  maxInputTokens: 8000
```

### Field Details

- **provider**: The LLM provider to use
  - Supported: `openai`, `anthropic`, `google`, `groq`, `openai-compatible`
  - Some providers require `baseURL` (e.g., `openai-compatible`)

- **model**: Provider-specific model identifier
  - Validated against provider's supported models
  - Use `openai-compatible` for custom models

- **apiKey**: Authentication key
  - Can reference environment variables: `$OPENAI_API_KEY`
  - Required, will error if missing

- **router**: Message routing strategy
  - `vercel`: Use Vercel AI SDK router (default, recommended)
  - `in-built`: Use Dexto's built-in router
  - Not all models support all routers

- **maxInputTokens**: Override automatic token limit
  - Required for unknown/custom models
  - Cannot exceed model's actual capacity

### See Also

- **[Supported LLM Providers](../supported-llm-providers.md)** - Complete provider and model listings

## System Prompt Configuration

Define your agent's behavior and personality using either a simple string or structured contributors.

### Schema

**Simple string:**
```yaml
systemPrompt: |
  You are a helpful AI assistant.
```

**Structured contributors:**
```yaml
systemPrompt:
  contributors:
    - id: string                  # Unique identifier
      type: static | dynamic | file | memory
      priority: number            # Execution order (lower first)
      enabled: boolean            # Optional, default: true
      # Type-specific fields below
```

### Contributor Types

**Static** - Fixed text content:
```yaml
- id: core
  type: static
  priority: 0
  content: |
    Your instructions here
```

**Dynamic** - Runtime-generated content:
```yaml
- id: timestamp
  type: dynamic
  priority: 10
  source: dateTime | resources
```

**File** - Load external files:
```yaml
- id: docs
  type: file
  priority: 20
  files: ["path/to/file.md"]
  options:
    includeFilenames: true
    separator: "\n\n---\n\n"
    errorHandling: skip | error
    maxFileSize: 100000
```

**Memory** - Load user memories:
```yaml
- id: context
  type: memory
  priority: 30
  options:
    pinnedOnly: false
    limit: 20
    includeTimestamps: true
    includeTags: true
```

### See Also

- **[System Prompt Guide](./systemPrompt.md)** - Concepts, contributor types, and use cases
- **[Memory Configuration](./memory.md)** - Memory system and pinned memories

## MCP Servers

Configure Model Context Protocol (MCP) servers to extend your agent's capabilities with external tools and services.

MCP servers are external processes or services that provide tools, resources, and APIs your agent can discover and use at runtime. Unlike internal tools, MCP servers follow the standardized Model Context Protocol.

### Quick Reference

**Three server types:**
```yaml
mcpServers:
  # Local process (stdio)
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
    timeout: 30000
    connectionMode: lenient

  # Server-Sent Events (deprecated)
  remote-sse:
    type: sse
    url: https://api.example.com/mcp/events
    headers:
      Authorization: Bearer $API_TOKEN
    timeout: 30000
    connectionMode: lenient

  # HTTP (recommended for remote)
  api-service:
    type: http
    url: https://api.example.com/mcp
    headers:
      Authorization: Bearer $API_TOKEN
    timeout: 30000
    connectionMode: strict
```

**Connection modes:**
- `lenient` (default) - Log errors, continue without server
- `strict` - Require successful connection or fail startup

**Environment variables:**
- All fields support `$ENV_VAR` or `${ENV_VAR}` expansion
- Store secrets in `~/.dexto/.env`

### Comprehensive Guide

For detailed documentation including:
- Complete field references for each server type
- Environment variable configuration
- Tool aggregation and naming
- Connection modes and error handling
- Common patterns and best practices
- Troubleshooting guide
- Example configurations

See the **[MCP Configuration guide](./mcpConfiguration.md)**.

### Related

- [MCP Configuration](./mcpConfiguration.md) - Comprehensive MCP configuration
- [MCP Overview](../../mcp/overview.md) - What is MCP and why it matters
- [Tool Confirmation](./toolConfirmation.md) - Control MCP tool execution

### See Also

- **[MCP Configuration](./mcpConfiguration.md)** - Comprehensive MCP server setup and configuration

## Tool Confirmation

Configure tool approval and confirmation behavior.

### Schema

```yaml
toolConfirmation:
  mode: string                  # event-based | auto-approve | auto-deny (default: event-based)
  timeout: number               # Timeout in milliseconds (default: 120000)
  allowedToolsStorage: string   # memory | storage (default: storage)
  toolPolicies:                 # Optional: static allow/deny lists
    alwaysAllow: [string]       # Tools that never require approval
    alwaysDeny: [string]        # Tools that are always denied (takes precedence)
```

### Confirmation Modes

- **`event-based`**: Interactive approval (user confirms each tool usage)
- **`auto-approve`**: Automatically approve all tools
- **`auto-deny`**: Automatically deny all tools

### Tool Policies

Define static allow/deny lists for fine-grained control. Use fully qualified tool names.

**Tool Name Format:**
- Internal tools: `internal--tool_name` (e.g., `internal--ask_user`)
- MCP tools: `mcp--server_name--tool_name` (e.g., `mcp--filesystem--read_file`)

### Example

```yaml
toolConfirmation:
  mode: event-based
  timeout: 120000
  allowedToolsStorage: storage

  toolPolicies:
    # Low-risk tools that never require approval
    alwaysAllow:
      - internal--ask_user
      - mcp--filesystem--read_file
      - mcp--filesystem--list_directory
      - mcp--filesystem--list_allowed_directories

    # High-risk tools that are always denied
    alwaysDeny:
      - mcp--filesystem--delete_file
      - mcp--playwright--execute_script
```

### Storage Types

- **`memory`**: Tool approvals persist only for the current session
- **`storage`**: Tool approvals persist across sessions (saved to database)

### See Also

- **[Tool Confirmation Guide](./toolConfirmation.md)** - Detailed tool approval configuration and policies

## Storage Configuration

Configure storage backends for cache, database, and blob storage.

### Schema

```yaml
storage:
  cache:
    type: in-memory | redis
    # ... type-specific fields

  database:
    type: in-memory | sqlite | postgres
    # ... type-specific fields

  blob:
    type: in-memory | local
    # ... type-specific fields
```

### Cache Configuration

#### In-Memory Cache

```yaml
storage:
  cache:
    type: in-memory
    maxConnections: 10          # Optional
    idleTimeoutMillis: 30000    # Optional
    connectionTimeoutMillis: 5000 # Optional
```

#### Redis Cache

```yaml
storage:
  cache:
    type: redis
    url: $REDIS_URL             # Option 1: Connection URL
    # OR
    host: localhost             # Option 2: Individual fields
    port: 6379
    password: $REDIS_PASSWORD
    database: 0
    maxConnections: 10
    idleTimeoutMillis: 30000
```

### Database Configuration

#### In-Memory Database

```yaml
storage:
  database:
    type: in-memory
```

#### SQLite Database

```yaml
storage:
  database:
    type: sqlite
    path: "${{dexto.agent_dir}}/data/dexto.db"  # Optional: custom path (auto-detected if omitted)
    database: dexto.db                           # Optional: database filename
    maxConnections: 1
```

#### PostgreSQL Database

```yaml
storage:
  database:
    type: postgres
    url: $POSTGRES_URL          # Option 1: Connection URL
    # OR
    connectionString: $POSTGRES_CONNECTION # Option 2: Connection string
    # OR
    host: localhost             # Option 3: Individual fields
    port: 5432
    database: dexto
    password: $POSTGRES_PASSWORD
    maxConnections: 10
```

### Blob Storage Configuration

Configure large file storage backend. Used when `blob` resource is enabled in `internalResources`.

#### In-Memory Blob Storage

```yaml
storage:
  blob:
    type: in-memory
    maxBlobSize: 10485760       # Optional: 10MB per blob (default)
    maxTotalSize: 104857600     # Optional: 100MB total (default)
```

#### Local Filesystem Blob Storage

```yaml
storage:
  blob:
    type: local
    storePath: ~/.dexto/blobs   # Optional: custom path (defaults to context-aware path)
    maxBlobSize: 52428800       # Optional: 50MB per blob (default)
    maxTotalSize: 1073741824    # Optional: 1GB total (default)
    cleanupAfterDays: 30        # Optional: auto-cleanup after 30 days (default)
```

### Complete Storage Example

```yaml
storage:
  cache:
    type: in-memory

  database:
    type: sqlite
    # path will be auto-detected using context-aware resolution

  blob:
    type: local
    maxBlobSize: 52428800       # 50MB per blob
    maxTotalSize: 1073741824    # 1GB total storage
    cleanupAfterDays: 30        # Auto-cleanup blobs older than 30 days
```

### See Also

- **[Storage Configuration Guide](./storage.md)** - Storage backends and configuration options

## Session Configuration

Configure session management limits and timeouts.

### Schema

```yaml
sessions:
  maxSessions: number           # Maximum concurrent sessions (default: 100)
  sessionTTL: number            # Session time-to-live in milliseconds (default: 3600000)
```

### Example

```yaml
sessions:
  maxSessions: 100              # Maximum 100 concurrent sessions
  sessionTTL: 3600000           # 1 hour session lifetime
```

### Field Details

- **maxSessions**: Maximum number of concurrent active sessions
  - Default: `100`
  - Type: Positive integer

- **sessionTTL**: Session time-to-live in milliseconds
  - Default: `3600000` (1 hour)
  - Type: Positive integer
  - Sessions inactive longer than this are cleaned up

### See Also

- **[Session Configuration Guide](./sessions.md)** - Session management and multi-session support

## Telemetry Configuration

OpenTelemetry distributed tracing for observability and debugging.

### Schema

```yaml
telemetry:
  enabled: boolean              # Enable/disable telemetry (default: false)
  serviceName: string           # Service name in traces (default: agent name)
  tracerName: string            # Tracer identifier (default: 'dexto-tracer')
  export:                       # Export configuration
    type: 'otlp' | 'console'    # Export type
    protocol: 'http' | 'grpc'   # OTLP protocol (default: 'http')
    endpoint: string            # OTLP collector endpoint
    headers:                    # Optional authentication headers
      [key: string]: string
```

### Configuration Options

**enabled** (boolean, default: `false`)
- Turn telemetry on/off
- No overhead when disabled

**serviceName** (string, default: agent name)
- Identifies your agent in trace backends
- Use different names for different deployments

**tracerName** (string, default: `'dexto-tracer'`)
- Internal tracer identifier
- Usually doesn't need customization

**export.type** (`'otlp'` | `'console'`)
- `otlp` - Export to OTLP-compatible backend (Jaeger, Grafana, etc.)
- `console` - Print traces to terminal (development only)

**export.protocol** (`'http'` | `'grpc'`, default: `'http'`)
- OTLP transmission protocol
- HTTP is easier to set up, gRPC is more efficient

**export.endpoint** (string)
- URL of OTLP collector/backend
- HTTP example: `http://localhost:4318/v1/traces`
- gRPC example: `http://localhost:4317`

**export.headers** (optional)
- Authentication headers for cloud backends
- Example: `Authorization: Bearer ${API_TOKEN}`

### Example Configurations

**Local Development with Jaeger:**
```yaml
telemetry:
  enabled: true
  serviceName: my-development-agent
  export:
    type: otlp
    protocol: http
    endpoint: http://localhost:4318/v1/traces
```

**Production with Grafana Cloud:**
```yaml
telemetry:
  enabled: true
  serviceName: my-production-agent
  export:
    type: otlp
    endpoint: https://otlp-gateway-prod.grafana.net/otlp
    headers:
      authorization: "Basic ${GRAFANA_CLOUD_TOKEN}"
```

**Console Output (Debugging):**
```yaml
telemetry:
  enabled: true
  export:
    type: console
```

**Disabled:**
```yaml
telemetry:
  enabled: false
  # Or omit the telemetry section entirely
```

### What Gets Traced

Dexto automatically traces:
- **Agent operations** - Main orchestration (agent.run, etc.)
- **LLM calls** - All model invocations with token usage
- **Tool executions** - Tool calls and results

See [Telemetry Configuration](./telemetry.md) for complete documentation.

### See Also

- **[Telemetry Configuration Guide](./telemetry.md)** - OpenTelemetry setup and tracing configuration

## Plugins

Configure built-in and custom plugins for input/output processing.

### Schema

```yaml
plugins:
  # Built-in plugins
  contentPolicy:
    priority: number            # Execution priority (lower runs first)
    blocking: boolean           # If true, errors halt execution
    enabled: boolean            # Enable/disable plugin (default: true)
    # Plugin-specific configuration fields...

  responseSanitizer:
    priority: number
    blocking: boolean
    enabled: boolean
    # Plugin-specific configuration fields...

  # Custom plugins
  custom:
    - name: string              # Unique plugin name
      module: string            # Path to plugin module
      enabled: boolean          # Enable/disable plugin
      blocking: boolean         # If true, errors halt execution
      priority: number          # Execution priority
      config:                   # Plugin-specific configuration
        # ... custom fields
```

### Built-in Plugins

#### Content Policy

Validates and sanitizes input before sending to LLM.

```yaml
plugins:
  contentPolicy:
    priority: 10
    blocking: true
    enabled: true
    maxInputChars: 50000        # Maximum input length
    redactEmails: true          # Redact email addresses
    redactApiKeys: true         # Redact API keys
```

#### Response Sanitizer

Sanitizes LLM responses before returning to user.

```yaml
plugins:
  responseSanitizer:
    priority: 900
    blocking: false
    enabled: true
    redactEmails: true          # Redact email addresses
    redactApiKeys: true         # Redact API keys
    maxResponseLength: 100000   # Maximum response length
```

### Custom Plugins

Load custom plugins from file paths.

```yaml
plugins:
  custom:
    - name: tenant-auth
      module: "${{dexto.agent_dir}}/plugins/tenant-auth.ts"
      enabled: true
      blocking: true
      priority: 100
      config:
        enforceQuota: true
        maxRequestsPerHour: 1000
```

### Complete Example

```yaml
plugins:
  contentPolicy:
    priority: 10
    blocking: true
    maxInputChars: 50000
    redactEmails: true
    redactApiKeys: true
    enabled: true

  responseSanitizer:
    priority: 900
    blocking: false
    redactEmails: true
    redactApiKeys: true
    maxResponseLength: 100000
    enabled: true

  custom:
    - name: custom-auth
      module: "${{dexto.agent_dir}}/plugins/auth.ts"
      enabled: true
      blocking: true
      priority: 50
      config:
        apiKey: $PLUGIN_API_KEY
```

### See Also

- **[Plugins Guide](./plugins.md)** - Plugin system and custom plugin development

## Internal Tools

Enable built-in Dexto tools that provide core agent capabilities like file operations, code search, and command execution.

### Quick Reference

```yaml
internalTools:
  - ask_user       # Ask questions and collect user input
  - read_file      # Read file contents
  - write_file     # Write content to files
  - edit_file      # Edit files by replacing text
  - glob_files     # Find files using glob patterns
  - grep_content   # Search file contents with regex
  - bash_exec      # Execute shell commands
  - bash_output    # Get output from background processes
  - kill_process   # Terminate background processes
```

### Available Tools

Dexto provides **9 built-in internal tools**:

1. **`ask_user`** - Ask questions and collect structured input
2. **`read_file`** - Read file contents with pagination
3. **`write_file`** - Write content to files
4. **`edit_file`** - Edit files by replacing exact text
5. **`glob_files`** - Find files using glob patterns (e.g., `**/*.ts`)
6. **`grep_content`** - Search file contents using regex
7. **`bash_exec`** - Execute shell commands
8. **`bash_output`** - Retrieve output from background processes
9. **`kill_process`** - Terminate background processes

### Disabling Internal Tools

An empty array or omitted field disables all internal tools:

```yaml
internalTools: []
```

### Comprehensive Documentation

For detailed documentation on each tool including parameters, use cases, examples, and best practices, see the dedicated **[Internal Tools guide](./internalTools.md)**.

### See Also

- **[Internal Tools Guide](./internalTools.md)** - Detailed documentation for each built-in tool

## Internal Resources

Configure internal resources that provide the agent with access to files and blob storage.

### Schema

```yaml
internalResources:
  enabled: boolean              # Optional: auto-enabled if resources array is non-empty
  resources:
    - type: filesystem          # Filesystem resource
      paths: [string]           # Required: directories/files to expose
      maxDepth: number          # Optional: max directory depth (default: 3, max: 10)
      maxFiles: number          # Optional: max files to index (default: 1000, max: 10000)
      includeHidden: boolean    # Optional: include hidden files (default: false)
      includeExtensions: [string] # Optional: file extensions to include

    - type: blob                # Blob storage resource (settings in storage.blob)
```

### Simplified Array Format

You can also specify resources as a simple array (auto-enables when non-empty):

```yaml
internalResources:
  - type: filesystem
    paths: ["."]
  - type: blob
```

### Filesystem Resource

Provides read access to local files for the agent.

**Fields:**
- `type`: `"filesystem"` (required)
- `paths`: Array of directories or files to expose (required, minimum 1)
- `maxDepth`: Maximum directory traversal depth (optional, default: `3`, range: 1-10)
- `maxFiles`: Maximum number of files to index (optional, default: `1000`, range: 1-10000)
- `includeHidden`: Include hidden files/directories (optional, default: `false`)
- `includeExtensions`: Whitelist of file extensions (optional, extensive defaults provided)

**Default Extensions:**
`.txt`, `.md`, `.js`, `.ts`, `.json`, `.html`, `.css`, `.py`, `.yaml`, `.yml`, `.xml`, `.jsx`, `.tsx`, `.vue`, `.php`, `.rb`, `.go`, `.rs`, `.java`, `.kt`, `.swift`, `.sql`, `.sh`, `.bash`, `.zsh`

### Blob Resource

Enables large file upload/storage capability. The actual storage backend and limits are configured in the `storage.blob` section.

**Fields:**
- `type`: `"blob"` (required)

### Example

```yaml
internalResources:
  enabled: true
  resources:
    - type: filesystem
      paths: [".", "./docs"]
      maxFiles: 50
      maxDepth: 3
      includeHidden: false
      includeExtensions: [".txt", ".md", ".json", ".yaml", ".yml", ".js", ".ts", ".py"]

    - type: blob
```

## Agent Identity / A2A

The `agentCard` section defines your agent's identity and capabilities, used for Agent-to-Agent (A2A) communication and discovery.

### Schema

```yaml
agentCard:
  name: string                    # Required: Agent name
  description: string             # Agent description (default provided)
  url: string                     # Required: Agent URL
  provider:                       # Optional: Provider information
    organization: string
    url: string
  version: string                 # Required: Version string
  documentationUrl: string        # Optional: Link to documentation
  capabilities:
    streaming: boolean            # Default: true
    pushNotifications: boolean    # Context-dependent
    stateTransitionHistory: boolean # Default: false
  authentication:
    schemes: [string]             # Default: []
    credentials: string           # Optional
  defaultInputModes: [string]     # Default: ['application/json', 'text/plain']
  defaultOutputModes: [string]    # Default: ['application/json', 'text/event-stream', 'text/plain']
  skills:                         # Array of skill definitions
    - id: string
      name: string
      description: string
      tags: [string]
      examples: [string]
      inputModes: [string]
      outputModes: [string]
```

### Example

```yaml
agentCard:
  name: "MyCustomAgent"
  description: "A specialized agent for data analysis"
  url: "https://myagent.example.com"
  provider:
    organization: "My Organization"
    url: "https://example.com"
  version: "1.0.0"
  documentationUrl: "https://docs.example.com"
  capabilities:
    streaming: true
    pushNotifications: false
  skills:
    - id: data_analysis
      name: "Data Analysis"
      description: "Analyze datasets and generate insights"
      tags: ["analysis", "data", "statistics"]
```

### See Also

- **[Agent Identity Guide](./agentCard.md)** - Agent-to-Agent (A2A) communication and discovery

## Dynamic Changes

For information about dynamically changing configuration at runtime (multi-environment overrides, hot-reload), see the **[Dynamic Changes guide](./dynamic-changes.md)**.

### See Also

- **[Dynamic Changes Guide](./dynamic-changes.md)** - Runtime configuration changes and environment overrides

## Global Preferences

To learn about global user preferences that apply across all agents, see the **[Global Preferences guide](./preferences.md)**.

### See Also

- **[Global Preferences Guide](./preferences.md)** - User preferences that apply across all agents

## Starter Prompts

Define clickable prompt buttons that appear in the WebUI for quick-start interactions.

### Schema

```yaml
starterPrompts:
  - id: string                  # Required: kebab-case identifier
    title: string               # Optional: display title (defaults to formatted id)
    description: string         # Optional: description text
    prompt: string              # Required: the actual prompt text
    category: string            # Optional: category for organization (default: "general")
    priority: number            # Optional: display order, higher appears first (default: 0)
```

### Field Details

- **id**: Unique kebab-case identifier (e.g., `quick-start`, `tool-demo`)
  - Required, must be unique
  - Regex: `^[a-z0-9]+(?:-[a-z0-9]+)*$`
  - Max length: 64 characters

- **title**: Display title shown on the button
  - Optional, defaults to formatted `id` (e.g., `quick-start` → `"quick start"`)

- **description**: Descriptive text shown on hover
  - Optional, defaults to empty string

- **prompt**: The actual prompt text that gets sent when clicked
  - Required, can be multi-line

- **category**: Category for grouping prompts
  - Optional, default: `"general"`
  - Common categories: `learning`, `tools`, `coding`, `analysis`

- **priority**: Display order
  - Optional, default: `0`
  - Higher numbers appear first

### Example

```yaml
starterPrompts:
  - id: quick-start
    title: "📚 Quick Start Guide"
    description: "Learn the basics and see what you can do"
    prompt: "I'd like to get started quickly. Can you show me a few examples of what you can do and help me understand how to work with you?"
    category: learning
    priority: 9

  - id: tool-demo
    title: "⚡ Tool Demonstration"
    description: "See the tools in action with practical examples"
    prompt: "I'd like to see your tools in action. Can you pick one of your most interesting tools and demonstrate it with a practical example? Show me what it can do and how it works."
    category: tools
    priority: 5

  - id: snake-game
    title: "🐍 Create Snake Game"
    description: "Build a fun interactive game"
    prompt: "Create a snake game in a new directory with HTML, CSS, and JavaScript, then open it in the browser for me to play."
    category: coding
    priority: 4

  - id: connect-tools
    title: "🔧 Connect New Tools"
    description: "Browse and add MCP servers to extend capabilities"
    prompt: "I want to connect new tools to expand my capabilities. Can you help me understand what MCP servers are available and how to add them?"
    category: tools
    priority: 3
```

## Greeting

Optional greeting message shown when a chat session starts.

### Schema

```yaml
greeting: string                # Max 500 characters
```

### Example

```yaml
greeting: "Hi! I'm Dexto — how can I help today?"
```

The greeting is consumed by UI clients and displayed when starting a new conversation.

### See Also

- **[Starter Prompts Guide](./starterPrompts.md)** - Creating interactive prompt buttons for WebUI

