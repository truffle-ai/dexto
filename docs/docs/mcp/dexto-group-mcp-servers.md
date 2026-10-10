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
2. Aggregates capabilities discovered at startup from these servers
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
  
  playwright:
    type: stdio
    command: npx
    args:
      - "-y"
      - "@playwright/mcp@latest"
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
## Connection ownership and protocol behavior

The grouped server forwards tool schemas and metadata, structured tool results (including
`isError` results), resource metadata and prompt arguments directly through MCP. It does not
run an AI agent or grant additional authority: your MCP client and each upstream server own
their authorization requirements.

Capabilities are a fixed snapshot of the initial discovery page from each connected upstream.
Restart the grouped server after upstream capability changes. Resource templates and discovery
pagination are not aggregated. Tools with conflicting names use the Core manager's qualified
names, such as `filesystem--read_file`; duplicate prompt names and ambiguous tool or resource
identities fail startup rather than silently selecting a server.

Strict startup requires every enabled configured server to connect. Otherwise, connections marked
lenient may fail while successful connections remain available. Shutdown or transport closure
releases the grouped server's upstream connections; failed initialization also releases acquired
connections. Disabled connections remain disabled even with strict startup.
