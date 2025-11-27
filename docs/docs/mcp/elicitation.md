---
sidebar_position: 4
---

# MCP Elicitation

## What is Elicitation?

Elicitation allows MCP servers to request structured user input during interactions. When a server needs specific data (like API keys, file paths, or configuration parameters), it can request that information through a defined JSON schema, and Dexto will prompt the user for input that matches that structure.

**Specification:** [MCP Elicitation Spec](https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation)

## How It Works

During tool execution or other server operations, an MCP server can:
1. Send an `elicitation/create` request with a JSON schema defining required input
2. Dexto prompts the user for the structured data
3. User provides input matching the schema
4. Dexto validates and returns the data to the server
5. Server continues with the provided information

This enables dynamic, context-aware data collection without requiring all parameters upfront.

## Configuration

Elicitation must be explicitly enabled in your agent configuration. It is disabled by default:

```yaml
# Enable elicitation support
elicitation:
  enabled: true  # Default: false
  timeout: 120000  # Optional: timeout in milliseconds (default: 120000)

# Connect MCP servers that support elicitation
mcpServers:
  my-server:
    type: stdio
    command: npx
    args: ["-y", "my-mcp-server"]
```

**Important:** Without `elicitation.enabled: true`, servers cannot request user input and elicitation requests will be rejected.

## Elicitation Schema

Servers define what data they need using JSON Schema:

```json
{
  "title": "API Configuration",
  "description": "Please provide your API credentials",
  "type": "object",
  "properties": {
    "apiKey": {
      "type": "string",
      "description": "Your API key"
    },
    "region": {
      "type": "string",
      "enum": ["us-east", "eu-west", "ap-south"],
      "description": "Preferred region"
    }
  },
  "required": ["apiKey", "region"]
}
```

Dexto validates user input against this schema before returning it to the server.

## Use Cases

Common scenarios where servers use elicitation:

- **Configuration parameters** - Requesting deployment regions, environment settings
- **File selection** - Asking users to choose specific files or paths
- **Disambiguation** - Clarifying ambiguous commands (e.g., "which branch?")
- **Progressive workflows** - Multi-step processes that need user decisions

## Security Considerations

:::warning Important
Elicitation is designed for workflow data, not sensitive credentials:
- ❌ DON'T: Request passwords, private keys, or PII through elicitation
- ✅ DO: Use for configuration, file paths, and workflow decisions
- Store sensitive data in environment variables or secure vaults
:::

## See Also

- [Tools](../concepts/tools) - Understanding agent tools and capabilities
- [MCP Prompts](./prompts) - Templated prompts from servers
- [MCP Overview](./overview) - Introduction to MCP
