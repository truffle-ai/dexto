---
sidebar_position: 7
title: "Dexto Agents as MCP Servers"
sidebar_label: "Dexto Agents as MCP Servers"
---

# Dexto Agents as MCP Servers

Any Dexto agent can also act as a Model Context Protocol (MCP) server, enabling external tools like Cursor/Claude Desktop or any MCP client to connect and interact with your Dexto agent.

This means you can even connect one Dexto agent to another Dexto agent!

You can use any of our pre-installed Dexto Agents (music-agent, database-agent, podcast-agent, etc.), or use your own yml config file as well

Check out our [Configuration guide](../guides/configuring-dexto/overview.md) to configure your own agent

## Prerequisites

- Install the Dexto CLI globally (`pnpm install -g dexto`, `npm install -g dexto`)
- Run `dexto` at least once so the setup flow can capture your provider credentials. Dexto stores secrets in `~/.dexto/.env`, so you no longer need to pass API keys through environment variables.

## Local MCP Server Guide

### Start the MCP server

Run Dexto in MCP mode to expose your agent over stdio:

```bash
dexto --mode mcp --auto-approve
```

During startup Dexto reads secrets from `.dexto/.env`, so your LLM credentials travel with your profile—no additional environment variables are required.

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

Just the `dexto` section for easy copying:

```json
"dexto": {
  "command": "dexto",
  "args": ["--mode", "mcp", "--auto-approve"]
}
```


Use `--agent` if you want to expose a specific agent (installed or from file):

```json
"dexto": {
  "command": "dexto",
  "args": ["--agent", "music-agent", "--mode", "mcp", "--auto-approve"]
}
```

Need debug logs? Add `DEXTO_LOG_LEVEL` env variable

```json
"dexto": {
  "command": "npx",
  "args": ["-y", "dexto", "--mode", "mcp", "--agent", "music-agent"],
  "env": { "DEXTO_LOG_LEVEL": "debug" }
}
```

Logs will be stored in `~/.dexto/logs/dexto.log`

> Looking for Cursor-specific instructions? See [Using Dexto Agents in Cursor](../guides/dexto-in-cursor.md).

Once connected, clients gain access to the agent tools defined in your configuration (filesystem, web browsing, custom MCP servers, etc.).

## Remote MCP Server Guide

Need to run your dexto agent as a remote MCP server?

### Step 1: Start Dexto in Server Mode

```bash
dexto --mode server
```

**Options:**
```bash
# Custom port using environment variable
API_PORT=8080 dexto --mode server

# Custom port for network access
API_PORT=3001 dexto --mode server

# Enable debug logging
dexto --mode server --debug
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
``` 
