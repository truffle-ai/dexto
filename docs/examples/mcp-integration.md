---
title: "Adding Custom MCP Servers"
---

import ExpandableImage from '@site/src/components/ExpandableImage';

# Adding Custom MCP Servers

Extend Dexto's capabilities by adding your own Model Context Protocol (MCP) servers with new tools and data sources.

<ExpandableImage src="https://github.com/user-attachments/assets/1a3ca1fd-31a0-4e1d-ba93-23e1772b1e79" alt="Add MCP Server Example" title="Adding Custom MCP Servers" width={900} />

## What it does

Add custom MCP servers to:
- Connect new tools and APIs
- Access external data sources
- Integrate third-party services
- Build custom functionality

## How to add MCP servers

### Option 1: Via Web UI

```bash
# Launch the Web UI
dexto
```

1. Click on "MCP Servers" in the sidebar
2. Click "Add Server"
3. Enter server configuration
4. Save and the server tools become available immediately

### Option 2: Via agent.yml

Edit your agent configuration file:

```yaml
# agents/my-agent.yml
mcpServers:
  custom-server:
    type: stdio
    command: npx
    args: ['-y', 'your-mcp-server-package']
    env:
      API_KEY: $YOUR_API_KEY
```

### Option 3: Via CLI

```bash
# Edit agent config directly
nano ~/.dexto/agents/your-agent.yml

# Or use the coding agent config
nano ~/.dexto/agents/coding-agent/coding-agent.yml
```

## Example: Adding Brave Search

```yaml
mcpServers:
  web-search:
    type: stdio
    command: npx
    args: ['-y', '@modelcontextprotocol/server-brave-search']
    env:
      BRAVE_API_KEY: $BRAVE_API_KEY
```

## Available MCP Servers

Browse 20+ ready-to-use MCP servers in the [MCP Store](/examples/mcp-store) including:
- **Filesystem** - File operations
- **Brave Search** - Web search
- **GitHub** - Repository management
- **Slack** - Team communication
- **PostgreSQL** - Database access
- And many more!

## Learn More

- [MCP Configuration Guide](/docs/guides/configuring-dexto/mcpConfiguration)
- [MCP Overview](/docs/mcp/overview)
- [MCP Manager](/docs/mcp/mcp-manager)
- [Official MCP Servers](https://github.com/modelcontextprotocol/servers)
