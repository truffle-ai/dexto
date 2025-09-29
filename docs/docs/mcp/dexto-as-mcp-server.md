---
sidebar_position: 3
title: Expose Dexto as an MCP Server
sidebar_label: "Expose Dexto as MCP Server"
description: Run Dexto as a local or remote MCP server for use in clients like Cursor or other MCP-compatible agents.
---

# Expose Dexto as an MCP Server

Dexto agents can act as Model Context Protocol (MCP) server, enabling external tools like Cursor/Claude Desktop or any MCP client to connect and interact with your Dexto agent.

This means you can even connect one Dexto agent to another Dexto agent!

The default Dexto agent has tools to access files and browse the web, but you can configure this too by changing the config file!

Check out our [Configuration guide](../guides/configuring-dexto/overview)

## Local MCP Server

### Start the MCP server

Run Dexto in MCP mode to expose your agent over stdio:

```bash
dexto --mode mcp
```

You can also use `npx dexto --mode mcp` without installing the CLI globally. Secrets configured through `dexto setup` are stored in `.dexto/.env`, so no additional environment variables are required.

### Connect an MCP client

Provide the command and arguments your client should execute. A minimal configuration looks like this:

```json
{
  "mcpServers": {
    "dexto": {
      "command": "npx",
      "args": ["-y", "dexto", "--mode", "mcp"]
    }
  }
}
```

Want to expose a different agent?

```json
{
  "command": "npx",
  "args": ["-y", "dexto", "--mode", "mcp", "--agent", "./agents/support.yml"]
}
```

> For a Cursor-specific walkthrough, see [Using Dexto Agents in Cursor](../guides/dexto-in-cursor).

## Remote MCP Server

### Step 1: Start Dexto in Server Mode

```bash
# If installed globally
dexto --mode server

# Or via npx
npx dexto --mode server
```

**Options:**
```bash
# Custom port using environment variable
API_PORT=8080 dexto --mode server
# Or via npx
API_PORT=8080 npx dexto --mode server

# Custom port for network access
API_PORT=3001 dexto --mode server
# Or via npx
API_PORT=3001 npx dexto --mode server

# Enable debug logging
dexto --mode server --debug
# Or via npx
npx dexto --mode server --debug
```

### Step 2: Configure the Connection URL

**HTTP MCP Endpoint:**
```bash
http://localhost:3001/mcp
```

**For network access:**
```bash
http://YOUR_SERVER_IP:3001/mcp
```

### Remote client limitations
Clients such as Cursor and Claude Desktop currently lack support for streaming HTTP MCP connections. Use the local stdio mode in those environments until support lands.

## Troubleshooting

**Cursor not detecting MCP server:**
- Verify `.cursor/mcp.json` syntax is correct
- Restart Cursor after configuration changes
- Ensure dexto is installed and accessible
- Verify environment variables are set correctly

**Debug mode:**
```bash
# If installed globally
dexto --mode mcp --debug

# Or via npx
npx dexto --mode mcp --debug
``` 
