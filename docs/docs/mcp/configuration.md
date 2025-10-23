---
title: MCP Configuration
sidebar_position: 4
sidebar_label: "MCP Configuration"
description: How to configure MCP servers in agent.yml and via runtime updates, with links to the full MCP docs for deeper guidance.
---

This page focuses on configuration tasks in `agent.yml` and runtime overrides. For concepts, transports, manager APIs, and advanced patterns, see the MCP section.

## agent.yml

Add servers under `mcpServers`. Dexto supports three server types: `stdio`, `sse`, and `http`.

### stdio Server Type

For local MCP servers running as child processes:

```yaml
mcpServers:
  filesystem:
    type: stdio
    command: npx
    args:
      - @modelcontextprotocol/server-filesystem
    env:
      ROOT: ./
    timeout: 30000
    connectionMode: lenient
  playwright:
    type: stdio
    command: npx
    args:
      - "-y"
      - "@playwright/mcp@latest"
```

**Fields:**
- `type` (required): Must be `stdio`
- `command` (required): Command to execute (e.g., `npx`, `python`, `node`)
- `args` (optional): Array of command arguments. Default: `[]`
- `env` (optional): Environment variables for the server process. Default: `{}`
- `timeout` (optional): Connection timeout in milliseconds. Default: `30000`
- `connectionMode` (optional): `lenient` or `strict`. Default: `lenient`

### sse Server Type

For Server-Sent Events (SSE) based MCP servers:

```yaml
mcpServers:
  remote-sse:
    type: sse
    url: https://api.example.com/mcp/events
    headers:
      Authorization: Bearer ${MCP_API_KEY}
      X-Custom-Header: value
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
      Content-Type: application/json
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

See: [MCP › Configure Connections](./connecting-servers.md)

## Runtime changes

- Add/update/remove servers dynamically via the SDK or REST APIs
- Events: `dexto:mcpServerAdded`, `dexto:mcpServerUpdated`, `dexto:mcpServerRemoved`

See: [MCP Manager](./mcp-manager.md)

## Next steps

- [MCP › Overview](./overview.md)
- [MCP › Configure Connections](./connecting-servers.md)
- [Dexto as an MCP Server](./dexto-as-mcp-server.md)

