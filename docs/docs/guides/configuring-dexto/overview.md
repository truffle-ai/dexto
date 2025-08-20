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

## Example Configuration File

```yaml
# agent.yml - Basic agent configuration
systemPrompt: |
  You are a helpful AI assistant with access to tools.
  Use these tools when appropriate to answer user queries.
  You can use multiple tools in sequence to solve complex problems.
  After each tool result, determine if you need more information or can provide a final answer.

llm:
  provider: openai
  model: gpt-4.1-mini
  # you can update the system prompt to change the behavior of the llm
  apiKey: $OPENAI_API_KEY

mcpServers:
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]

```

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

## Best Practices

- **Use environment variables** for secrets and API keys. Reference them in YML as `$VARNAME`.
- **Keep your config in version control** (but never commit secrets!). Use `.env` files or CI secrets for sensitive values.
- **Document your config** for your team. Add comments to your YML files. We chose YML for this reason.
- **Validate your config** before running Dexto in production.
- **See the `agents/examples/` folder for more templates and advanced use cases.**
 