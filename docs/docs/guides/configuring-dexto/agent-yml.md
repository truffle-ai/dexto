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
6. [Permissions](#permissions)
7. [Elicitation Configuration](#elicitation-configuration)
8. [Storage Configuration](#storage-configuration)
9. [Session Configuration](#session-configuration)
10. [Telemetry Configuration](#telemetry-configuration)
11. [Logger Configuration](#logger-configuration)
12. [Hooks](#hooks)
13. [Tools](#tools)
14. [Resources](#resources)
15. [Agent Identity / A2A](#agent-identity--a2a)
16. [Agent ID](#agent-id)
17. [Dynamic Changes](#dynamic-changes)
18. [Prompts](#prompts)
19. [Memories](#memories)
20. [Greeting](#greeting)
21. [Global Preferences](#global-preferences)

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

# System Prompt
systemPrompt:
  contributors:
    - id: primary
      type: static
      priority: 0
      content: |
        You are a helpful AI assistant with access to tools.
    - id: date
      type: dynamic
      priority: 10
      source: date

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

# Permissions
permissions:
  mode: manual
  timeout: 120000
  allowedToolsStorage: storage
  toolPolicies:
    alwaysAllow:
      - ask_user
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

# Logger
logger:
  level: info  # Set to 'info' for verbose logging (default is 'error')
  transports:
    - type: console
      colorize: true
    - type: file
      path: ./logs/agent.log
      maxSize: 10485760
      maxFiles: 5

# Hooks
hooks:
  - type: content-policy
    enabled: true
  - type: response-sanitizer
    enabled: true

# Tools
tools:
  - type: builtin-tools
    enabledTools:
      - ask_user
      - invoke_skill
      - delegate_to_url

  - type: filesystem-tools
    allowedPaths: ["."]
    blockedPaths: [".git", "node_modules/.bin", ".env"]
    enableBackups: false

  - type: process-tools
    securityLevel: moderate

# Resources
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

# Prompts
prompts:
  - type: inline
    id: quick-start
    title: "📚 Quick Start"
    prompt: "Show me what you can do!"
    category: learning
    priority: 9
    showInStarters: true

# Memories
memories:
  enabled: true
  priority: 40
  limit: 10

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
  provider: string              # Required: see supported providers below
  model: string                 # Required
  apiKey: string                # API key or $ENV_VAR (not required for vertex)
  maxIterations: number         # Optional, default: 50
  baseURL: string               # Optional (required for litellm, openai-compatible)
  maxInputTokens: number        # Optional
  maxOutputTokens: number       # Optional
  temperature: number           # Optional: 0.0-1.0
```

**Supported providers:**
- **Built-in:** `openai`, `anthropic`, `google`, `groq`, `xai`, `cohere`
- **Cloud platforms:** `vertex` (Google Cloud), `bedrock` (AWS)
- **Gateways:** `openrouter`, `litellm`, `glama`
- **Custom:** `openai-compatible`

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
See **[System Prompt Guide](./systemPrompt)** for detailed explanations. For memory integration, see **[Memories](#memories)**.
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
      type: static | dynamic | file
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
  source: date | resources

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

## Permissions

:::info Guide
For detailed policy configuration, see **[Permissions Guide](./permissions)**.
:::

Tool approval and confirmation behavior.

### Schema

```yaml
permissions:
  mode: manual | auto-approve | auto-deny  # Default: manual
  timeout: number               # Default: 120000ms
  allowedToolsStorage: memory | storage  # Default: storage
  toolPolicies:                 # Optional
    alwaysAllow: [string]       # Never require approval
    alwaysDeny: [string]        # Always denied (takes precedence)
```

### Tool Name Format

- Local: `tool_name`
- MCP: `mcp--server_name--tool_name`

### Example

```yaml
permissions:
  mode: manual
  toolPolicies:
    alwaysAllow:
      - ask_user
      - mcp--filesystem--read_file
    alwaysDeny:
      - mcp--filesystem--delete_file
```

## Elicitation Configuration

:::info Guide
For detailed information about MCP elicitation, see **[MCP Elicitation Guide](../../mcp/elicitation)**.
:::

Elicitation allows MCP servers to request structured user input during interactions. This must be explicitly enabled.

### Schema

```yaml
elicitation:
  enabled: true | false  # Default: false
  timeout: 120000  # Timeout in milliseconds (default: 120000)
```

### Configuration Options

| Field | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `enabled` | `boolean` | `false` | Enable elicitation support. When disabled, elicitation requests will be rejected. |
| `timeout` | `number` | `120000` | Maximum time to wait for user input (in milliseconds). |

### Example

```yaml
# Enable elicitation for MCP servers that need user input
elicitation:
  enabled: true
  timeout: 120000

# MCP servers can now request structured user input
mcpServers:
  my-server:
    type: stdio
    command: npx
    args: ["-y", "my-mcp-server"]
```

**Note:** Elicitation and permissions are independent features. Elicitation controls whether MCP servers can request user input, while permissions control whether tools require approval before execution.

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
  path: string                  # Required: full path to database file
  maxConnections: number        # Optional

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

## Logger Configuration

Multi-transport logging system with file, console, and remote transport support.

:::tip CLI Auto-Configuration
The CLI automatically adds a per-agent file transport at `~/.dexto/logs/<agent-id>.log`. You only need to configure this section if you want to customize logging behavior or add additional transports.
:::

### Schema

```yaml
logger:
  level: error | warn | info | debug | silly  # Default: error
  transports:
    - type: console | file
      # Type-specific fields below
```

### Log Levels

Following Winston convention (lower = more severe):
- `error` - Only critical errors (default)
- `warn` - Warnings and errors
- `info` - General information about agent operations
- `debug` - Detailed debugging information
- `silly` - Very detailed trace information

### Transport Types

```yaml
# Console Transport
- type: console
  colorize: boolean        # Default: true

# File Transport
- type: file
  path: string            # Required: full path to log file
  maxSize: number         # Default: 10485760 (10MB)
  maxFiles: number        # Default: 5 (rotation count)
```

### Examples

```yaml
# Console only (development)
logger:
  level: debug
  transports:
    - type: console
      colorize: true

# File only (production)
logger:
  level: info
  transports:
    - type: file
      path: ./logs/agent.log
      maxSize: 10485760
      maxFiles: 5

# Both console and file
logger:
  level: debug
  transports:
    - type: console
      colorize: true
    - type: file
      path: ./logs/agent.log
      maxSize: 10485760
      maxFiles: 5
```

### Per-Agent Log Files

The CLI automatically creates per-agent log files at:
- `~/.dexto/logs/<agent-id>.log`

Where `<agent-id>` is derived from:
1. `agentCard.name` (sanitized for filesystem)
2. Config filename (e.g., `my-agent.yml` → `my-agent`)
3. Fallback: `coding-agent`

## Hooks

:::info Guide
For hook development and configuration, see **[Hooks Guide](./hooks)**.
:::

Built-in and custom hooks for input/output processing.

### Schema

```yaml
hooks:
  - type: string
    enabled: boolean  # Optional
    # Hook-specific fields
```

### Example

```yaml
hooks:
  - type: content-policy
    enabled: true
    maxInputChars: 50000
    redactEmails: true
    redactApiKeys: true

  - type: response-sanitizer
    enabled: true
    redactEmails: true
    redactApiKeys: true
    maxResponseLength: 100000
```

## Tools

:::info Guide
For tool factory configuration examples, see **[Tools Guide](./tools)**.
:::

Tools are configured via a list of tool factory entries. Omit `tools` to use image defaults.

### Schema

```yaml
tools:
  - type: string
    enabled: boolean  # Optional
    # Tool-factory-specific fields
```

## Resources

:::info Guide
For detailed configuration and examples, see **[Resources Guide](./resources)**.
:::

Access to files and blob storage.

### Schema

```yaml
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

## Agent ID

Unique identifier for this agent instance, used for per-agent isolation of logs, database, and blob storage.

:::tip CLI Auto-Derives
The CLI automatically derives the agent ID from your `agentCard.name` or config filename. You rarely need to set this manually.
:::

### Schema

```yaml
agentId: string           # Default: derived from agentCard.name or filename
```

### Derivation Rules

The CLI derives `agentId` in this priority order:

1. **agentCard.name** (sanitized for filesystem):
   ```yaml
   agentCard:
     name: "My Custom Agent"  # → agentId: "my-custom-agent"
   ```

2. **Config filename** (without extension):
   ```text
   my-agent.yml            # → agentId: "my-agent"
   database-agent.yml      # → agentId: "database-agent"
   ```

3. **Fallback**: `coding-agent`

### Manual Override

```yaml
agentId: custom-id-123
```

Use this when you need explicit control over storage isolation or have multiple instances of the same agent.

## Prompts

Reusable prompts that can be defined inline or loaded from markdown files. Prompts with `showInStarters: true` appear as clickable buttons in the WebUI.

### Schema

```yaml
prompts:
  # Inline prompt (text defined in config)
  - type: inline
    id: string                  # Required, kebab-case, max 64 chars
    title: string               # Optional, defaults to formatted id
    description: string         # Optional
    prompt: string              # Required, the prompt content
    category: string            # Optional, default: "general"
    priority: number            # Optional, default: 0, higher appears first
    showInStarters: boolean     # Optional, default: false, show in WebUI starter buttons

  # File-based prompt (loaded from markdown file)
  - type: file
    file: string                # Required, path to markdown file
    showInStarters: boolean     # Optional, default: false
```

### Inline Prompt Example

```yaml
prompts:
  - type: inline
    id: quick-start
    title: "📚 Quick Start Guide"
    prompt: "Show me what you can do and how to work with you"
    category: learning
    priority: 9
    showInStarters: true

  - type: inline
    id: tool-demo
    title: "⚡ Tool Demonstration"
    prompt: "Pick an interesting tool and demonstrate it with a practical example"
    category: tools
    priority: 5
    showInStarters: true
```

### File-Based Prompt Example

File-based prompts are loaded from markdown files with optional frontmatter:

```yaml
prompts:
  - type: file
    file: "${{dexto.agent_dir}}/prompts/code-review.md"
    showInStarters: true
```

The markdown file can include frontmatter for metadata:

```markdown
---
id: code-review
title: "Code Review Assistant"
description: "Review code for best practices and issues"
category: development
priority: 10
argument-hint: "[file-path] [focus-area?]"
---

# Code Review

Please review the following code for:
- Best practices
- Potential bugs
- Performance issues

$ARGUMENTS
```

### Placeholder Syntax

Prompts support placeholder expansion:
- `$1`, `$2`, etc. - Positional arguments
- `$ARGUMENTS` - All arguments joined with spaces
- `$$` - Literal dollar sign

## Memories

Top-level configuration for memory retrieval in system prompts.

### Schema

```yaml
memories:
  enabled: boolean              # Default: false
  priority: number              # Default: 40, lower = earlier in prompt
  limit: number                 # Optional, max memories to include
  includeTimestamps: boolean    # Default: false
  includeTags: boolean          # Default: true
  pinnedOnly: boolean           # Default: false, only include pinned memories
```

### Example

```yaml
memories:
  enabled: true
  priority: 40
  limit: 15
  pinnedOnly: false
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
