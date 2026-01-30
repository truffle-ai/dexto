---
sidebar_position: 1
sidebar_label: "Overview"
---

# Configuring Dexto

Dexto's power comes from its customizability. You can customize every part of your Dexto agent with one `yml` config file.

:::tip Complete Configuration Reference
For the comprehensive reference of **all configuration options and field documentation**, see **[Complete agent.yml Configuration Reference](./agent-yml.md)**.

The guides in this section explain **concepts and use cases**. For detailed field specifications, always refer to the canonical reference.
:::

This guide walks through all the different features you can customize, and the expected format.

We chose `yml` instead of the more popular `json` because of better parsing libraries, and support for comments.

## Where to Place Your Config

By default, Dexto uses a configuration file named `coding-agent.yml`.

Dexto ships with in-built agents that are stored in `~/.dexto` directory.

You can also specify a custom config path using the CLI:

```bash
dexto --agent path/to/your-config.yml
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
    path: "${{dexto.agent_dir}}/data/dexto.db"

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

## Path Variables

Dexto supports path variables for portable configuration:

**`${{dexto.agent_dir}}`** - Resolves to the directory containing your agent's YAML file
- Use this for agent-relative paths in plugins, file contributors, and custom resources
- Makes your configuration portable when sharing or moving agents

**Example:**
```yaml
# Plugin with agent-relative path
plugins:
  custom:
    - name: my-plugin
      module: "${{dexto.agent_dir}}/plugins/auth.ts"

# System prompt file contributors with mixed paths
systemPrompt:
  contributors:
    - type: file
      files:
        - "${{dexto.agent_dir}}/context/guidelines.md"  # Agent-relative
        - /etc/system/shared-rules.md                    # Absolute path
```

## Best Practices

- **Use environment variables** for secrets and API keys. Reference them in YML as `$VARNAME`.
- **Keep your agent in version control** (but never commit secrets!). Use `.env` files or CI secrets for sensitive values.
- **Document your agent config** for your team. Add comments to your YML files. We chose YML for this reason.
- **Use $\{\{dexto.agent_dir\}\} for files used in your agent** - this helps you keep files close to your agent config.
- **Validate your agent** before running Dexto in production:
  ```bash
  # Test your configuration by doing a dry run
  dexto --agent ./my-agent.yml
  ```
- **See the `agents/` folder in [the Dexto GitHub repository](https://github.com/truffle-ai/dexto) for more templates and advanced use cases.**