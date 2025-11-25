---
sidebar_position: 1
title: MCP Overview
description: Understand the Model Context Protocol (MCP), why it matters, and how Dexto integrates with MCP servers and tools.
---

# What is MCP?

The **Model Context Protocol (MCP)** is an open protocol created and maintained by Anthropic - [MCP github organization](https://github.com/modelcontextprotocol)

MCP defines how AI agents (like Dexto agents) can discover, connect to, and interact with external tools, services, and APIs in a standardized way.

:::tip Comprehensive Documentation
For complete MCP server configuration documentation including detailed field references, environment variables, tool aggregation, troubleshooting, and best practices, see the **[MCP Configuration Guide](../guides/configuring-dexto/mcpConfiguration.md)**.
:::

## Why MCP Matters

- **Interoperability:** MCP provides a common language for agents and tools, making it easy to connect new services without custom integration code for each one.
- **Extensibility:** Anyone can build and share MCP-compatible tools, expanding what agents can do.
- **Modularity:** Tools are decoupled from the agent's core logic, so you can add, remove, or swap tools as needed.

## How Dexto Agents Use MCP

Dexto agents use MCP to:
- **Discover available tools:** MCP servers advertise what actions they support (e.g., read a file, send an email, browse the web).
- **Connect to tools:** Dexto agents communicate with MCP servers using a standard protocol (often over stdio, HTTP, or sockets).
- **Invoke tool actions:** When you give a command, Dexto selects the right tool(s) via MCP and orchestrates their use to fulfill your request.
- **Read server resources:** Dexto agents can read resources from the server, like files, databases, etc., and use that to reason about what to do next.
- **Request structured input:** Servers can use elicitation to request specific data from users during workflows.

## Quick Configuration Reference

Add MCP servers under `mcpServers` in your `agent.yml`. Dexto supports three server types: `stdio`, `sse`, and `http`.

### stdio Server Type

For local MCP servers running as child processes:

```yaml
mcpServers:
  filesystem:
    type: stdio
    command: npx
    args:
      - "@modelcontextprotocol/server-filesystem"
    env:
      ROOT: ./
    timeout: 30000
    connectionMode: lenient
```

**Fields:**
- `type` (required): Must be `stdio`
- `command` (required): Command to execute (e.g., `npx`, `python`, `node`)
- `args` (optional): Array of command arguments. Default: `[]`
- `env` (optional): Environment variables for the server process. Default: `{}`
- `timeout` (optional): Connection timeout in milliseconds. Default: `30000`
- `connectionMode` (optional): `lenient` or `strict`. Default: `lenient`

### sse Server Type

:::warning Deprecated
SSE transport is deprecated. Use `http` type for remote MCP servers instead.
:::

For Server-Sent Events (SSE) based MCP servers:

```yaml
mcpServers:
  remote-sse:
    type: sse
    url: https://api.example.com/mcp/events
    headers:
      Authorization: Bearer ${MCP_API_KEY}
    timeout: 30000
    connectionMode: lenient
```

**Fields:**
- `type` (required): Must be `sse`
- `url` (required): SSE endpoint URL. Supports environment variable expansion (e.g., `${VAR}`)
- `headers` (optional): HTTP headers to send with requests. Default: `{}`
- `timeout` (optional): Connection timeout in milliseconds. Default: `30000`
- `connectionMode` (optional): `lenient` or `strict`. Default: `lenient`

### http Server Type

For HTTP-based MCP servers:

```yaml
mcpServers:
  remote-http:
    type: http
    url: https://api.example.com/mcp
    headers:
      Authorization: Bearer ${MCP_API_KEY}
    timeout: 30000
    connectionMode: strict
```

**Fields:**
- `type` (required): Must be `http`
- `url` (required): HTTP server URL. Supports environment variable expansion (e.g., `${VAR}`)
- `headers` (optional): HTTP headers to send with requests. Default: `{}`
- `timeout` (optional): Connection timeout in milliseconds. Default: `30000`
- `connectionMode` (optional): `lenient` or `strict`. Default: `lenient`

### Connection Modes

The `connectionMode` field controls how Dexto handles connection failures:

- **`lenient` (default)**: If the server fails to connect, Dexto logs a warning but continues initialization. The server can be retried later. Use this for optional servers or when you want graceful degradation.

- **`strict`**: If the server fails to connect, Dexto throws an error and stops initialization. Use this for critical servers that must be available for your agent to function properly.

## Runtime Changes

- Add/update/remove servers dynamically via the SDK or REST APIs
- Events: `mcp:server-added`, `mcp:server-updated`, `mcp:server-removed`

See: [MCP Manager](./mcp-manager.md)

## Learn More

- [Model Context Protocol documentation](https://modelcontextprotocol.io/introduction)
- [MCP reference servers on GitHub](https://github.com/modelcontextprotocol/reference-servers)

MCP is a key part of what makes Dexto flexible, extensible, and able to automate across a wide range of tools and services.

## Next Steps

- **[MCP Configuration Guide](../guides/configuring-dexto/mcpConfiguration)** - Comprehensive YAML configuration
- [MCP Resources](./resources) - Expose data and context from MCP servers
- [MCP Prompts](./prompts) - Discover and use templated prompts
- [MCP Elicitation](./elicitation) - Request structured user input during workflows
- [Agent Configuration Reference](../guides/configuring-dexto/agent-yml) - Complete agent.yml reference
- [MCP Manager](./mcp-manager) - Runtime server management
- [Aggregate Multiple Servers](./dexto-group-mcp-servers) - Group MCP servers
- [Expose Dexto as MCP Server](./dexto-as-mcp-server) - Use Dexto as an MCP server
