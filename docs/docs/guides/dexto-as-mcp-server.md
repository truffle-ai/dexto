---
sidebar_position: 7
title: "Dexto Agents as MCP Servers"
sidebar_label: "Dexto Agents as MCP Servers"
---

# Dexto Agents as MCP Servers

Any Dexto agent can also act as a Model Context Protocol (MCP) server, enabling external tools like Cursor/Claude Desktop or any MCP client to connect and interact with your Dexto agent.

This means you can even connect one Dexto agent to another Dexto agent!

The default Dexto agent has tools to access files and browse the web, but you can configure this too by changing the config file!

Check out our [Configuration guide](./configuring-dexto/overview)

## Local MCP Server Guide

### Start the MCP server

Run Dexto in MCP mode to expose your agent over stdio:

```bash
dexto --mode mcp --auto-approve
```

The command works with globally installed CLIs as well as `npx dexto --mode mcp` for one-off runs. During startup Dexto reads secrets from `.dexto/.env`, so your LLM credentials travel with your profile—no additional environment variables are required.

### Connect an MCP client

Most MCP-compatible clients expect a command plus optional arguments. A minimal configuration looks like:

```json
{
  "mcpServers": {
    "dexto": {
      "command": "dexto",
      "args": ["--mode", "mcp", "--auto-approve"]
    }
  }
}
```

Use `--agent` if you want to expose a specific agent (installed or from file):

```json
{
  "command": "npx",
  "args": ["-y", "dexto", "--mode", "mcp", "--agent", "music-agent"]
}
```

> Looking for Cursor-specific instructions? See [Using Dexto Agents in Cursor](./dexto-in-cursor.md).

Once connected, clients gain access to the agent tools defined in your configuration (filesystem, web browsing, custom MCP servers, etc.).

## Remote MCP Server Setup

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
Some MCP clients (including Cursor and Claude Desktop today) do not yet support streaming HTTP connections. For those clients, prefer the local stdio transport covered above.

## Troubleshooting

**Issues in Cursor:**
- Check Dexto logs - `~/.dexto/logs/dexto.log`
- Run agent in debug mode
- Reach out for support on Truffle AI discord

**Debug mode:**
```bash
# If installed globally
dexto --mode mcp --debug

# Or via npx
npx dexto --mode mcp --debug
``` 
