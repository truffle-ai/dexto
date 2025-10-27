---
title: "Portable Agents: Use Your Agents from Cursor"
---

# Portable Agents: Use Your Agents from Cursor

Dexto agents are modular, composable, and portable - run them from anywhere including Cursor, Claude Desktop, and other MCP clients.

<img src="https://github.com/user-attachments/assets/fd75a63f-4d29-447a-be24-6943e34c387f" alt="Cursor Integration Demo" width="600"/>

## What it does

Connect to Dexto as an MCP server to use your agents from any MCP-compatible client:
- Run Dexto agents from Cursor
- Use agents in Claude Desktop
- Integrate with custom MCP clients
- Share agents across tools and environments

## How it works

1. **Start Dexto as an MCP server:**
```bash
dexto --mode mcp --agent podcast-agent
```

2. **Configure your MCP client** (e.g., Cursor, Claude Desktop):
```json
{
  "mcpServers": {
    "dexto-podcast": {
      "command": "dexto",
      "args": ["--mode", "mcp", "--agent", "podcast-agent"]
    }
  }
}
```

3. **Use the agent** from your MCP client just like any other tool!

## Example: Podcast Agent in Cursor

In this example, we expose the Podcast Agent as an MCP server and use it from Cursor to generate podcast intros while coding.

```bash
# Start Dexto as MCP server with podcast agent
dexto --mode mcp --agent podcast-agent
```

Then in Cursor, the Podcast Agent's tools become available as native MCP tools.

## Benefits

- **Portable**: Same agent, multiple interfaces
- **Composable**: Combine agents from different sources
- **Consistent**: Agent behavior stays the same across clients
- **Reusable**: Build once, use everywhere

## Learn More

- [Expose Dexto as MCP Server](/docs/mcp/dexto-as-mcp-server)
- [Agent Configuration](/docs/guides/configuring-dexto/overview)
- [MCP Overview](/docs/mcp/overview)
