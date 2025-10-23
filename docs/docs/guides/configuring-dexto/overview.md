---
sidebar_position: 1
sidebar_label: "Overview"
---

# Configuring Dexto

Dexto's power comes from its customizability. You can customize every part of your Dexto agent with one `yml` config file. 

This guide walks through all the different features you can customize, and the expected format.

We chose `yml` instead of the more popular `json` because of better parsing libraries, and support for comments.

## Where to Place Your Config

By default, Dexto uses a configuration file named `default-agent.yml`.

Dexto ships with in-built agents that are stored in ~/.dexto directory.

You can also specify a custom config path using the CLI:

```bash
dexto --agent path/to/your-config.yml
```

## Complete Configuration Reference

For a comprehensive reference of all available configuration options, see the [Complete agent.yml Configuration Reference](./agent-yml).

This reference includes detailed schemas, examples, and explanations for:

- **Core Configuration**: System prompts, greetings, and basic setup
- **LLM Configuration**: Provider settings, models, and parameters  
- **MCP Servers**: Tool integrations and server configurations
- **Storage**: Database and cache configuration options
- **Sessions**: Session management and lifecycle settings
- **Agent Card**: Metadata for Agent-to-Agent communication
- **Advanced Features**: Tool confirmation, internal tools, and plugins

The complete reference provides both minimal examples to get started quickly and comprehensive configurations for production deployments.

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
  model: claude-sonnet-4-5-20250929
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

- **agentCard:**
  - Configure your agent's public metadata for Agent-to-Agent (A2A) communication and service discovery
  - [Complete Reference](./agentCard)
- **systemPrompt:**
  - Define the core instructions and personality for your agent
  - [Complete Reference](./system-prompt)
- **llm:**
  - This section defines the configuration for the LLM that your agent will use as its brain
  - [Complete Reference](./llm)
- **mcpServers:**
  - This section represents the different MCP servers that you want to connect to your agent
  - Each key represents a different MCP server
  - [Complete Reference](./mcp)
- **internalTools:**
  - Configure built-in tools like memory management, file operations, and web browsing
  - [Complete Reference](./internal-tools)
- **internalResources:**
  - Configure built-in resources for accessing system information and capabilities
  - [Complete Reference](./internal-resources)
- **storage:**
  - This section defines where the agent will store conversation history, settings, and other data
  - [Complete Reference](./storage)
- **toolConfirmation:**
  - This section controls how and when users are prompted to approve tool execution
  - Configure confirmation modes, timeouts, and approval storage
  - [Complete Reference](./tool-confirmation)
- **session:**
  - Configure session management including timeouts, persistence, and cleanup
  - [Complete Reference](./session)
- **plugins:**
  - Configure external plugins to extend your agent's capabilities
  - [Complete Reference](./plugins)
- **starterPrompts:**
  - Define suggested prompts that users can quickly select to start conversations
  - [Complete Reference](./starter-prompts)
- **greeting:**
  - Simple string used by UI layers to show an initial chat message or welcome text
  - Optional; omit it if your UI handles welcome state differently
  - [Complete Reference](./greeting)

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