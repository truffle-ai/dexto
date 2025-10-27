---
title: "MCP Store: Tool Discovery & Integration"
---

import ExpandableImage from '@site/src/components/ExpandableImage';

# MCP Store: Tool Discovery & Integration

Equip your agents with 20+ MCP servers and start using them via chat - instantly.

<ExpandableImage src="/assets/mcp_store_demo.gif" alt="MCP Store Demo" title="MCP Store: Tool Discovery & Integration" width={900} />

## What it does

The MCP Store provides a curated collection of ready-to-use MCP servers:
- **Discover tools** from the integrated marketplace
- **Install with one click** directly from the Web UI
- **Bring your own keys** for API-based services
- **Start using immediately** - no configuration needed

## How to use

1. **Launch Web UI:**
```bash
dexto --mode web
```

2. **Open MCP Store:**
   - Click "MCP Store" in the sidebar
   - Browse available servers
   - View server details, required keys, and capabilities

3. **Install a server:**
   - Click "Install" on any server
   - Provide required API keys if needed
   - Server tools become available instantly

4. **Use in conversation:**
```
"Search the web for latest AI news"  # Uses Brave Search
"List files in this directory"  # Uses Filesystem tools
"Send a message to the team channel"  # Uses Slack integration
```

## Available Servers

Browse the integrated MCP Store to discover available servers. The store includes servers across categories like:

- **Search & Web** - Brave Search, web scraping
- **Development** - Filesystem access, Git operations
- **Communication** - Slack integration
- **Data** - Database connections, file operations
- **AI** - Image generation, audio processing

Check the Web UI MCP Store to see the current list of available servers with installation instructions and requirements.

## Contributing

Can't find an MCP server you need?
- [Contribute to the registry](https://github.com/truffle-ai/dexto/blob/main/CONTRIBUTING.md)
- [Build your own MCP server](https://modelcontextprotocol.io/)
- Submit a feature request

## Learn More

- [MCP Overview](/docs/mcp/overview)
- [MCP Configuration](/docs/guides/configuring-dexto/mcpConfiguration)
- [Official MCP Servers](https://github.com/modelcontextprotocol/servers)
