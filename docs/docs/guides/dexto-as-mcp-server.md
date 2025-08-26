---
sidebar_position: 7
title: "Using Dexto as an MCP Server"
sidebar_label: "Using Dexto as an MCP Server"
---

# Using Dexto as an MCP Server

Dexto agents can act as Model Context Protocol (MCP) server, enabling external tools like Cursor/Claude Desktop or any MCP client to connect and interact with your Dexto agent.

This means you can even connect one Dexto agent to another Dexto agent!

The default Dexto agent has tools to access files and browse the web, but you can configure this too by changing the config file!

Check out our [Configuration guide](./configuring-dexto/overview)

## Local MCP Server Guide

### Setup in Cursor

1. **Create or edit your `.cursor/mcp.json` file:**

Use the default Dexto configuration
```json
{
  "mcpServers": {
    "dexto": {
      "command": "npx",
      "args": ["-y", "dexto", "--mode", "mcp"],
      "env": {
        "OPENAI_API_KEY": "your_openai_api_key"
      }
    }
  }
}
```

Using a custom Dexto configuration:
Note: if you use a different LLM in your config file, you will need to pass the appropriate environment variable for that provider.

```json
{
  "mcpServers": {
    "dexto": {
      "command": "npx",
      "args": ["-y", "dexto", "--mode", "mcp", "--agent", "path/to/your/agent.yml"],
      "env": {
        "OPENAI_API_KEY": "your_openai_api_key"
      }
    }
  }
}
```


2. **Restart Cursor**

### Using Dexto in Cursor

**Available Tools in Cursor:**
- `chat_with_agent`: Interact with Dexto AI agent

**Available Dexto tools:**

By default, Dexto CLI loads an AI agent that has tools to:
- browse the web
- search files on your local system

But you can customize the tools by using a custom Dexto agent configuration file. Check out our [Configuration guide](./configuring-dexto/overview).

**Example Usage in Cursor:**

1. **Refactor a function:**
   ```bash
   Ask Dexto agent to help me refactor this function to be more efficient
   ```

2. **Get file analysis:**
   ```bash
   Ask Dexto agent to analyze the architecture of this project
   ```

3. **Browse the web:**
   ```bash
   Ask Dexto agent to search the web for soccer shoes under $100
   ```

4. **Any custom functionality:**
    You can configure your Dexto agent to have any other custom functionality by setting up your own config file and using it here. Check out our [Configuration guide](./configuring-dexto/overview)

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

### Remote Server in Cursor (WIP)
Cursor/Claude desktop don't support streamable http yet

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