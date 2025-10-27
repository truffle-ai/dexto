---
title: Complete agent.yml
sidebar_position: 2
sidebar_label: "Complete agent.yml"
---
# agent.yml – Configuration Reference

Complete reference for all agent.yml configuration options.

## Table of Contents

1. [Minimal Configuration](#minimal-configuration)
2. [Complete Example](#complete-example)
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
15. [Starter Prompts](#starter-prompts)
16. [Greeting](#greeting)
17. [Global Preferences](#global-preferences)

## Minimal Configuration

```yaml
systemPrompt: |
  You are a helpful AI assistant.

llm:
  provider: anthropic
  model: claude-sonnet-4-5-20250929
  apiKey: $ANTHROPIC_API_KEY
```

## Complete Example

```yaml
# LLM
llm:
  provider: openai
  model: gpt-5
  apiKey: $OPENAI_API_KEY
  maxIterations: 50
  router: vercel

# System Prompt
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

:::info Guides
For configuration details and examples, see **[LLM Configuration](./llm)**.

For supported providers and models, see **[Supported LLM Providers](../supported-llm-providers)**.
:::

Language model provider and settings.

### Schema

```yaml
llm:
  provider: string              # Required: openai | anthropic | google | groq | openai-compatible
  model: string                 # Required
  apiKey: string                # Required: API key or $ENV_VAR
  maxIterations: number         # Optional, default: 50
  router: string                # Optional: vercel | in-built, default: vercel
  baseURL: string               # Optional
  maxInputTokens: number        # Optional
  maxOutputTokens: number       # Optional
  temperature: number           # Optional: 0.0-1.0
```

### Examples

```yaml
# OpenAI
llm:
  provider: openai
  model: gpt-5
  apiKey: $OPENAI_API_KEY

# Anthropic
llm:
  provider: anthropic
  model: claude-sonnet-4-5-20250929
  apiKey: $ANTHROPIC_API_KEY

# OpenAI-Compatible
llm:
  provider: openai-compatible
  model: custom-model-name
  apiKey: $CUSTOM_API_KEY
  baseURL: https://api.custom-provider.com/v1
```


## System Prompt Configuration

:::info Guides
See **[System Prompt Guide](./systemPrompt)** and **[Memory Configuration](./memory)** for detailed explanations.
:::

Agent behavior and personality.

### Schema

```yaml
# Simple string
systemPrompt: |
  Your instructions

# Structured contributors
systemPrompt:
  contributors:
    - id: string                  # Required, unique
      type: static | dynamic | file | memory
      priority: number            # Lower runs first
      enabled: boolean            # Optional, default: true
```

### Contributor Types

```yaml
# Static
- id: core
  type: static
  priority: 0
  content: |
    Your instructions

# Dynamic
- id: timestamp
  type: dynamic
  priority: 10
  source: dateTime | resources

# File
- id: docs
  type: file
  priority: 20
  files: ["path/to/file.md"]
  options:
    includeFilenames: boolean
    separator: string
    errorHandling: skip | error
    maxFileSize: number

# Memory
- id: context
  type: memory
  priority: 30
  options:
    pinnedOnly: boolean
    limit: number
    includeTimestamps: boolean
    includeTags: boolean
```

## MCP Servers

:::info Guide
For detailed configuration and examples, see **[MCP Configuration](./mcpConfiguration)**.
:::

External tools and services via Model Context Protocol.

### Schema

```yaml
mcpServers:
  server-name:
    type: stdio | sse | http
    timeout: number               # Optional, default: 30000
    connectionMode: lenient | strict  # Optional, default: lenient
    # Type-specific fields below
```

### Server Types

```yaml
# stdio - Local process
filesystem:
  type: stdio
  command: npx
  args: ["-y", "@modelcontextprotocol/server-filesystem", "."]

# sse - Server-Sent Events (deprecated)
remote-sse:
  type: sse
  url: https://api.example.com/mcp/events
  headers:
    Authorization: Bearer $API_TOKEN

# http - HTTP (recommended for remote)
api-service:
  type: http
  url: https://api.example.com/mcp
  headers:
    Authorization: Bearer $API_TOKEN
```

### Connection Modes

- `lenient` (default) - Log errors, continue without server
- `strict` - Require successful connection or fail startup

## Tool Confirmation

:::info Guide
For detailed policy configuration, see **[Tool Confirmation Guide](./toolConfirmation)**.
:::

Tool approval and confirmation behavior.

### Schema

```yaml
toolConfirmation:
  mode: event-based | auto-approve | auto-deny  # Default: event-based
  timeout: number               # Default: 120000ms
  allowedToolsStorage: memory | storage  # Default: storage
  toolPolicies:                 # Optional
    alwaysAllow: [string]       # Never require approval
    alwaysDeny: [string]        # Always denied (takes precedence)
```

### Tool Name Format

- Internal: `internal--tool_name`
- MCP: `mcp--server_name--tool_name`

### Example

```yaml
toolConfirmation:
  mode: event-based
  toolPolicies:
    alwaysAllow:
      - internal--ask_user
      - mcp--filesystem--read_file
    alwaysDeny:
      - mcp--filesystem--delete_file
```

## Storage Configuration

:::info Guide
For detailed storage options and examples, see **[Storage Configuration Guide](./storage)**.
:::

Storage backends for cache, database, and blob storage.

### Schema

```yaml
storage:
  cache:
    type: in-memory | redis
  database:
    type: in-memory | sqlite | postgres
  blob:
    type: in-memory | local
```

### Cache Types

```yaml
# In-Memory
cache:
  type: in-memory
  maxConnections: number        # Optional
  idleTimeoutMillis: number     # Optional
  connectionTimeoutMillis: number  # Optional

# Redis
cache:
  type: redis
  url: $REDIS_URL               # Option 1
  # OR
  host: string                  # Option 2
  port: number
  password: string
  database: number
  maxConnections: number
  idleTimeoutMillis: number
```

### Database Types

```yaml
# In-Memory
database:
  type: in-memory

# SQLite
database:
  type: sqlite
  path: string                  # Optional, auto-detected
  database: string              # Optional
  maxConnections: number

# PostgreSQL
database:
  type: postgres
  url: $POSTGRES_URL            # Option 1
  # OR
  connectionString: string      # Option 2
  # OR
  host: string                  # Option 3
  port: number
  database: string
  password: string
  maxConnections: number
```

### Blob Storage Types

```yaml
# In-Memory
blob:
  type: in-memory
  maxBlobSize: number           # Default: 10485760 (10MB)
  maxTotalSize: number          # Default: 104857600 (100MB)

# Local Filesystem
blob:
  type: local
  storePath: string             # Optional, auto-detected
  maxBlobSize: number           # Default: 52428800 (50MB)
  maxTotalSize: number          # Default: 1073741824 (1GB)
  cleanupAfterDays: number      # Default: 30
```

## Session Configuration

:::info Guide
For detailed session behavior, see **[Session Configuration Guide](./sessions)**.
:::

Session management limits and timeouts.

### Schema

```yaml
sessions:
  maxSessions: number           # Default: 100
  sessionTTL: number            # Default: 3600000ms (1 hour)
```

## Telemetry Configuration

:::info Guide
For detailed telemetry setup, see **[Telemetry Configuration Guide](./telemetry)**.
:::

OpenTelemetry distributed tracing.

### Schema

```yaml
telemetry:
  enabled: boolean              # Default: false
  serviceName: string           # Default: agent name
  tracerName: string            # Default: 'dexto-tracer'
  export:
    type: otlp | console
    protocol: http | grpc       # Default: http
    endpoint: string            # OTLP collector URL
    headers:                    # Optional
      [key: string]: string
```

### Examples

```yaml
# Local Jaeger
telemetry:
  enabled: true
  export:
    type: otlp
    protocol: http
    endpoint: http://localhost:4318/v1/traces

# Grafana Cloud
telemetry:
  enabled: true
  export:
    type: otlp
    endpoint: https://otlp-gateway-prod.grafana.net/otlp
    headers:
      authorization: "Basic ${GRAFANA_CLOUD_TOKEN}"

# Console (debugging)
telemetry:
  enabled: true
  export:
    type: console
```

## Plugins

:::info Guide
For plugin development and configuration, see **[Plugins Guide](./plugins)**.
:::

Built-in and custom plugins for input/output processing.

### Schema

```yaml
plugins:
  # Built-in
  contentPolicy:
    priority: number
    blocking: boolean
    enabled: boolean
    # Plugin-specific fields

  responseSanitizer:
    priority: number
    blocking: boolean
    enabled: boolean
    # Plugin-specific fields

  # Custom
  custom:
    - name: string
      module: string
      enabled: boolean
      blocking: boolean
      priority: number
      config: {}
```

### Built-in Plugins

```yaml
# Content Policy
contentPolicy:
  priority: 10
  blocking: true
  enabled: true
  maxInputChars: 50000
  redactEmails: boolean
  redactApiKeys: boolean

# Response Sanitizer
responseSanitizer:
  priority: 900
  blocking: false
  enabled: true
  redactEmails: boolean
  redactApiKeys: boolean
  maxResponseLength: 100000
```

### Custom Plugins

```yaml
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

## Internal Tools

:::info Guide
For tool descriptions and usage patterns, see **[Internal Tools Guide](./internalTools)**.
:::

Built-in tools for file operations, code search, and command execution.

### Schema

```yaml
internalTools:
  - ask_user
  - read_file
  - write_file
  - edit_file
  - glob_files
  - grep_content
  - bash_exec
  - bash_output
  - kill_process
```

### Available Tools

- `ask_user` - Ask questions and collect user input
- `read_file` - Read file contents
- `write_file` - Write content to files
- `edit_file` - Edit files by replacing text
- `glob_files` - Find files using glob patterns
- `grep_content` - Search file contents with regex
- `bash_exec` - Execute shell commands
- `bash_output` - Get output from background processes
- `kill_process` - Terminate background processes

## Internal Resources

Access to files and blob storage.

### Schema

```yaml
internalResources:
  enabled: boolean              # Optional, auto-enabled if resources non-empty
  resources:
    - type: filesystem
      paths: [string]           # Required
      maxDepth: number          # Optional, default: 3, max: 10
      maxFiles: number          # Optional, default: 1000, max: 10000
      includeHidden: boolean    # Optional, default: false
      includeExtensions: [string]  # Optional

    - type: blob                # Settings in storage.blob
```

### Resource Types

```yaml
# Filesystem
- type: filesystem
  paths: [".", "./docs"]
  maxFiles: 50
  maxDepth: 3
  includeHidden: false
  includeExtensions: [".txt", ".md", ".json", ".js", ".ts", ".py"]

# Blob
- type: blob
```

### Default File Extensions

`.txt`, `.md`, `.js`, `.ts`, `.json`, `.html`, `.css`, `.py`, `.yaml`, `.yml`, `.xml`, `.jsx`, `.tsx`, `.vue`, `.php`, `.rb`, `.go`, `.rs`, `.java`, `.kt`, `.swift`, `.sql`, `.sh`, `.bash`, `.zsh`

## Agent Identity / A2A

:::info Guide
For agent card configuration, see **[Agent Identity Guide](./agentCard)**.
:::

Agent identity and capabilities for [Agent-to-Agent (A2A)](https://a2a-protocol.org/latest/) communication.

### Schema

```yaml
agentCard:
  name: string                    # Required
  description: string
  url: string                     # Required
  provider:
    organization: string
    url: string
  version: string                 # Required
  documentationUrl: string
  capabilities:
    streaming: boolean            # Default: true
    pushNotifications: boolean
    stateTransitionHistory: boolean  # Default: false
  authentication:
    schemes: [string]             # Default: []
    credentials: string
  defaultInputModes: [string]     # Default: ['application/json', 'text/plain']
  defaultOutputModes: [string]    # Default: ['application/json', 'text/event-stream', 'text/plain']
  skills:
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
  version: "1.0.0"
  capabilities:
    streaming: true
    pushNotifications: false
  skills:
    - id: data_analysis
      name: "Data Analysis"
      description: "Analyze datasets and generate insights"
      tags: ["analysis", "data", "statistics"]
```

## Dynamic Changes

:::info Guide
For runtime configuration and overrides, see **[Dynamic Changes Guide](./dynamic-changes)**.
:::

Runtime configuration changes and environment overrides.

## Starter Prompts

Clickable prompt buttons for WebUI.

### Schema

```yaml
starterPrompts:
  - id: string                  # Required, kebab-case, max 64 chars
    title: string               # Optional, defaults to formatted id
    description: string         # Optional
    prompt: string              # Required
    category: string            # Optional, default: "general"
    priority: number            # Optional, default: 0, higher appears first
```

### Example

```yaml
starterPrompts:
  - id: quick-start
    title: "📚 Quick Start Guide"
    prompt: "Show me what you can do and how to work with you"
    category: learning
    priority: 9

  - id: tool-demo
    title: "⚡ Tool Demonstration"
    prompt: "Pick an interesting tool and demonstrate it with a practical example"
    category: tools
    priority: 5
```

## Greeting

Greeting message shown when chat session starts.

### Schema

```yaml
greeting: string                # Max 500 characters
```

### Example

```yaml
greeting: "Hi! I'm Dexto — how can I help today?"
```

## Global Preferences

:::tip
For system-wide CLI preferences (default LLM provider, model, default agent), see the **[Global Preferences Guide](../cli/global-preferences)**.
:::
