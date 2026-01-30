---
sidebar_position: 2
---

# MCP Resources

## What are Resources?

Resources in the Model Context Protocol let MCP servers expose data (files, documentation, API responses) that LLMs can read for context. Think of them as read-only data sources that help the LLM understand your environment.

**Specification:** [MCP Resources Spec](https://spec.modelcontextprotocol.io/specification/2025-03-26/server/resources/)

## How It Works

When you connect an MCP server that supports resources, Dexto automatically:
1. Discovers available resources during server connection
2. Lists resources with their URIs and descriptions
3. Fetches resource content when the LLM needs it

## Configuration

Resources are discovered automatically from MCP servers:

```yaml
mcpServers:
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "./docs"]
```

No additional setup needed - if the server supports resources, Dexto will expose them.

## Using Resources

### In Web UI

Use the `@` symbol to reference resources:
```
@file:///project/README.md what does this say about installation?
```

The Web UI auto-completes available resources when you type `@`.

### Via SDK

```typescript
// List all available resources
const resources = await agent.resourceManager.list();

// Read a specific resource
const content = await agent.resourceManager.read('file:///path/to/file.md');
```

## Resource URIs

Resources are identified by URIs with different schemes:

- **file://** - Local files: `file:///absolute/path/to/file.txt`
- **http://** - Web resources: `http://api.example.com/data`
- **Custom** - Server-defined: `db://database/schema`, `git://repo/file`

## Common Servers with Resources

Based on Dexto's agent registry:

- **@modelcontextprotocol/server-filesystem** - Exposes local files (used in coding-agent)
- **@truffle-ai/github-mcp-server** - GitHub repository contents (used in github-agent)
- **@truffle-ai/talk2pdf-mcp** - PDF document contents (used in talk2pdf-agent)

## See Also

- [Internal Resources](../guides/configuring-dexto/internalResources) - Agent-managed filesystem/blob resources
- [MCP Prompts](./prompts) - Templated prompts from servers
- [MCP Overview](./overview) - Introduction to MCP
