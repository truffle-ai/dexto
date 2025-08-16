---
sidebar_position: 8
sidebar_label: "Using Dexto to group MCP servers"
---

# Using Dexto CLI to group MCP servers together

Dexto can operate in **MCP Tools Mode**, where it acts as a local tool aggregation server that groups MCP servers and re-exposes them all under 1 common MCP server. 

Unlike the regular MCP server mode where you interact with a Dexto AI agent, this mode provides direct access to the underlying tools without an AI intermediary.

This is useful when you want to:
- Access tools from multiple MCP servers through a single connection
- Group tools directly without AI agent processing
- Create a centralized tool hub for your development environment

## How It Works

In MCP Tools Mode, Dexto:
1. Connects to multiple MCP servers as configured
2. Aggregates all available tools from these servers
3. Exposes them directly as its own local MCP server
4. Acts as a pass-through for tool execution

## Configuration

### Step 1: Create a Dexto Configuration File

Create a `dexto-tools.yml` configuration file with the MCP servers you want to aggregate:

```yaml
# dexto-tools.yml
mcpServers:
  filesystem:
    type: stdio
    command: npx
    args:
      - -y
      - "@modelcontextprotocol/server-filesystem"
      - "."
  
  puppeteer:
    type: stdio
    command: npx
    args:
      - -y
      - "@truffle-ai/puppeteer-server"
```

 - You don't need LLM configuration for tools mode
 - Only the mcpServers section is used

### Step 2: Setup in Cursor

Add the following to your `.cursor/mcp.json` file:

```json
{
  "mcpServers": {
    "dexto-tools": {
      "command": "npx",
      "args": [
        "-y", 
        "dexto", 
        "mcp",
        "--group-servers",
        "-a",
        "path/to/your/dexto-tools.yml"
      ]
    }
  }
}
```

Or use the default Dexto configuration

```json
{
  "mcpServers": {
    "dexto-tools": {
      "command": "npx",
      "args": [
        "-y", 
        "dexto", 
        "mcp",
        "--group-servers"
      ]
    }
  }
}
```

### Step 3: Restart Cursor

After adding the configuration, restart Cursor to load the new MCP server. 