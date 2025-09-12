---
title: MCP Configuration
sidebar_position: 4
sidebar_label: "MCP Configuration"
description: How to configure MCP servers in agent.yml and via runtime updates, with links to the full MCP docs for deeper guidance.
---

This page focuses on configuration tasks in `agent.yml` and runtime overrides. For concepts, transports, manager APIs, and advanced patterns, see the MCP section.

## agent.yml

Add servers under `mcpServers`:

```yaml
mcpServers:
  filesystem:
    type: stdio
    command: npx
    args:
      - @modelcontextprotocol/server-filesystem
    env:
      ROOT: ./
  playwright:
    type: stdio
    command: npx
    args:
      - "-y"
      - "@playwright/mcp@latest"
```

See: [MCP › Configure Connections](../../mcp/connecting-servers)

## Runtime changes

- Add/update/remove servers dynamically via the SDK or REST APIs
- Events: `dexto:mcpServerAdded`, `dexto:mcpServerUpdated`, `dexto:mcpServerRemoved`

See: [MCP › MCP Manager](../../mcp/mcp-manager)

## Next steps

- [MCP › Overview](../../mcp/overview)
- [MCP › Configure Connections](../../mcp/connecting-servers)
- [MCP › Dexto as an MCP Server](../../mcp/dexto-as-mcp-server)


