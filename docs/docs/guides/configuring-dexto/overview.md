---
sidebar_position: 1
sidebar_label: "Overview"
---

# Configuring Dexto

Dexto's power comes from its customizability. You can customize every part of your Dexto agent with one `yml` config file. 

This guide walks through all the different features you can customize, and the expected format.

We chose `yml` instead of the more popular `json` because of its support for comments (which we find super useful!), and better parsing libraries.

## Where to Place Your Config

By default, Dexto uses a configuration file named `agents/default-agent.yml`. You can also specify a custom config path using the CLI:

```bash
dexto --agent path/to/your-config.yml
```

## Complete Configuration Reference

Here's a complete skeleton showing all available configuration options:

```yaml
# Complete Dexto Agent Configuration Template
# Copy and customize as needed - all fields are optional except where noted

# =============================================================================
# CORE CONFIGURATION
# =============================================================================

# Optional greeting shown when a chat starts (for UI consumption)
greeting: "Hello! I'm your Dexto agent."

# System prompt configuration (REQUIRED)
systemPrompt:
  contributors:
    - id: primary
      type: static
      priority: 0
      enabled: true
      content: |
        You are a helpful AI assistant with access to tools.
        Use these tools when appropriate to answer user queries.
    - id: dateTime
      type: dynamic
      priority: 10
      source: dateTime
      enabled: true
    - id: context_files
      type: file
      priority: 5
      enabled: true
      files:
        - "./docs/context.md"
        - "./README.md"

# Alternatively, use simple string format:
# systemPrompt: "You are a helpful AI assistant with access to tools."

# =============================================================================
# LLM CONFIGURATION (REQUIRED)
# =============================================================================

llm:
  provider: openai                    # openai | anthropic | google | groq | xai | cohere
  model: gpt-5-mini                   # Specific model name
  apiKey: $OPENAI_API_KEY            # API key (use $ENV_VAR format)
  maxIterations: 50                   # Max iterations for agentic loops
  router: vercel                      # vercel | in-built
  baseURL: https://api.openai.com/v1  # Custom base URL (optional)
  maxInputTokens: 128000             # Max input tokens (auto-detected for known models)
  maxOutputTokens: 4096              # Max output tokens (optional)
  temperature: 0.7                    # Randomness: 0-1 (optional)

# =============================================================================
# MCP SERVERS (TOOLS)
# =============================================================================

mcpServers:
  # stdio servers (most common)
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
    env:
      CUSTOM_VAR: "value"
    timeout: 30000
    connectionMode: lenient           # strict | lenient
    
  # HTTP servers
  web_api:
    type: http
    url: $API_SERVER_URL
    headers:
      Authorization: "Bearer $API_TOKEN"
    timeout: 30000
    connectionMode: lenient
    
  # SSE servers
  realtime_data:
    type: sse
    url: $SSE_ENDPOINT_URL
    headers:
      Authorization: "Bearer $SSE_TOKEN"
    timeout: 30000
    connectionMode: lenient

# =============================================================================
# STORAGE CONFIGURATION
# =============================================================================

storage:
  # Fast ephemeral cache
  cache:
    type: in-memory                   # in-memory | redis
    # Redis cache options:
    # type: redis
    # url: $REDIS_URL
    # host: localhost
    # port: 6379
    # password: $REDIS_PASSWORD
    # database: 0
    # maxConnections: 10
    
  # Persistent database
  database:
    type: sqlite                      # sqlite | postgres | in-memory
    path: ./data/dexto.db            # SQLite file path
    # PostgreSQL options:
    # type: postgres
    # connectionString: $POSTGRES_CONNECTION_STRING
    # host: localhost
    # port: 5432
    # username: $DB_USER
    # password: $DB_PASSWORD
    # database: dexto
    # maxConnections: 25

# =============================================================================
# SESSION MANAGEMENT
# =============================================================================

sessions:
  maxSessions: 100                    # Maximum concurrent sessions
  sessionTTL: 3600000                # Session TTL in milliseconds (1 hour)

# =============================================================================
# TOOL CONFIRMATION
# =============================================================================

toolConfirmation:
  mode: auto                         # auto | always | never
  timeout: 30000                     # Confirmation timeout in milliseconds
  storage: 
    type: in-memory                  # in-memory | persistent
  allowedTools:
    provider: storage                # storage | in-memory
    # Pre-approved tools (skip confirmation)
    tools:
      - readFile
      - writeFile

# =============================================================================
# INTERNAL TOOLS
# =============================================================================

internalTools:
  searchHistory:
    enabled: true                    # Enable conversation search
    maxResults: 50                   # Max search results

# =============================================================================
# AGENT CARD (MCP Server Mode)
# =============================================================================

agentCard:
  name: "My Custom Agent"
  description: "A helpful AI assistant with custom capabilities"
  url: "http://localhost:3000"
  provider:
    organization: "My Organization"
    url: "https://myorg.com"
  version: "1.0.0"
  documentationUrl: "https://docs.myorg.com"
  capabilities:
    streaming: true
    pushNotifications: false
    stateTransitionHistory: false
  authentication:
    schemes: ["bearer"]
    credentials: "optional"
  defaultInputModes: ["application/json", "text/plain"]
  defaultOutputModes: ["application/json", "text/event-stream"]
  skills:
    - id: custom_skill
      name: "Custom Skill"
      description: "My custom agent capability"
      tags: ["custom", "ai"]
      examples: ["Example usage"]
      inputModes: ["text/plain"]
      outputModes: ["text/plain"]
```

## Common Configuration Patterns

### Local Development
```yaml
llm:
  provider: openai
  model: gpt-5-mini
  apiKey: $OPENAI_API_KEY

storage:
  cache:
    type: in-memory
  database:
    type: sqlite
    path: ./data/dexto.db

mcpServers:
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
```

### Production Setup
```yaml
llm:
  provider: openai
  model: gpt-5-mini
  apiKey: $OPENAI_API_KEY

storage:
  cache:
    type: redis
    url: $REDIS_URL
    maxConnections: 10
  database:
    type: postgres
    connectionString: $POSTGRES_CONNECTION_STRING
    maxConnections: 25

sessions:
  maxSessions: 1000
  sessionTTL: 86400000  # 24 hours

mcpServers:
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/data"]
    connectionMode: strict
```

### Docker Deployment
```yaml
llm:
  provider: anthropic
  model: claude-4-sonnet-20250514
  apiKey: $ANTHROPIC_API_KEY

storage:
  cache:
    type: redis
    host: redis
    port: 6379
  database:
    type: postgres
    host: postgres
    port: 5432
    username: $DB_USER
    password: $DB_PASSWORD
    database: dexto

mcpServers:
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/app/data"]
```

## Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `OPENAI_API_KEY` | Yes* | OpenAI API key | `sk-proj-...` |
| `ANTHROPIC_API_KEY` | Yes* | Anthropic API key | `sk-ant-...` |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Yes* | Google AI API key | `AIza...` |
| `GROQ_API_KEY` | Yes* | Groq API key | `gsk_...` |
| `XAI_API_KEY` | Yes* | xAI API key | `xai-...` |
| `COHERE_API_KEY` | Yes* | Cohere API key | `co-...` |
| `REDIS_URL` | No | Redis connection URL | `redis://localhost:6379` |
| `POSTGRES_CONNECTION_STRING` | No | PostgreSQL connection | `postgresql://user:pass@host:5432/db` |
| `DEXTO_LOG_LEVEL` | No | Log level | `silly`, `debug`, `info`, `warn`, `error` |

*At least one LLM provider API key is required. Individual provider keys are optional - choose the provider you want to use.

## Key Sections Explained

- **mcpServers:**
  - This section represents the different MCP servers that you want to connect to your agent
  - Each key represents a different MCP server
  - [Complete Reference](../../mcp/connecting-servers)
- **llm:**
  - This section defines the configuration for the LLM that your agent will use as its brain.
  - [Complete Reference](./llm)
- **storage:**
  - This section defines where the agent will store conversation history, settings, and other data. 
  - [Complete Reference](./storage)
- **toolConfirmation:**
  - This section controls how and when users are prompted to approve tool execution
  - Configure confirmation modes, timeouts, and approval storage
  - [Complete Reference](./toolConfirmation)
- **greeting:**
  - Simple string used by UI layers to show an initial chat message or welcome text
  - Optional; omit it if your UI handles welcome state differently

## Best Practices

- **Use environment variables** for secrets and API keys. Reference them in YML as `$VARNAME`.
- **Keep your config in version control** (but never commit secrets!). Use `.env` files or CI secrets for sensitive values.
- **Document your config** for your team. Add comments to your YML files. We chose YML for this reason.
- **Validate your config** before running Dexto in production:
  ```bash
  # Test your configuration by doing a dry run
  dexto --agent ./my-agent.yml --help
  ```
- **See the `agents/examples/` folder for more templates and advanced use cases.**