---
title: "Playground: Interactive Development Environment"
---

# Playground: Interactive Development Environment

A testing playground to view tools in your MCP servers before connecting them to LLMs to see detailed response structures.

<img src="/assets/playground_demo.gif" alt="Playground Demo" width="600"/>

## What it does

The Playground provides an interactive environment to:
- **Explore MCP server tools** without running the full agent
- **Test tool parameters** and see responses in real-time
- **Inspect response structures** for debugging
- **Validate server connections** before integration
- **Develop and debug** custom MCP servers

## How to access

```bash
# Launch Web UI
dexto --mode web
```

Navigate to "Playground" in the sidebar.

## Features

### 1. Server Browser
- View all connected MCP servers
- See available tools for each server
- Inspect tool schemas and parameters

### 2. Tool Tester
- Select any tool from connected servers
- Fill in parameters with a guided form
- Execute tools directly
- View formatted responses

### 3. Response Inspector
- See full JSON responses
- Expand/collapse nested structures
- Copy response data
- View error messages and stack traces

### 4. Connection Validator
- Test server connectivity
- Verify authentication
- Check tool availability
- Debug connection issues

## Use Cases

### Developing MCP Servers
Test your custom MCP server tools before integrating with agents:

```bash
# Start your MCP server
dexto --mode mcp

# In another terminal, test it in playground
dexto --mode web
```

### Debugging Tool Issues
When a tool isn't working as expected, use the playground to:
1. Verify the tool exists
2. Check parameter requirements
3. Test with sample inputs
4. Inspect error responses

### Exploring New Servers
Before adding a new MCP server to your agent, explore its capabilities in the playground to understand what tools it provides and how to use them.

## Example Workflow

1. **Add a server** via Web UI or config
2. **Open Playground**
3. **Select server** from dropdown
4. **Choose a tool** to test
5. **Fill parameters** using the form
6. **Execute** and view response
7. **Iterate** until you understand the tool behavior

## Learn More

- [MCP Overview](/docs/mcp/overview)
- [MCP Configuration](/docs/guides/configuring-dexto/mcpConfiguration)
- [Building MCP Servers](https://modelcontextprotocol.io/)
- [Web UI Guide](/docs/guides/web-ui)
