---
sidebar_position: 8
title: "Using Dexto Agents in Cursor"
sidebar_label: "Dexto Agents in Cursor"
description: Connect Dexto agents to Cursor via the Model Context Protocol (MCP).
---


# Using Dexto Agents in Cursor

Cursor ships with native MCP support, which means you can talk to your Dexto agents directly inside the editor. This guide walks through the minimal configuration required and highlights a few power tips for customizing the experience.

## Prerequisites

- Install the Dexto CLI globally (`pnpm install -g dexto`, `npm install -g dexto`)
- Run `dexto` at least once so the setup flow can capture your provider credentials. Dexto stores secrets in `~/.dexto/.env`, so you no longer need to pass API keys through environment variables.

## Configure `.cursor/mcp.json`

Cursor looks for MCP definitions in `.cursor/mcp.json` within your project root. Add an entry that launches Dexto with your preferred agent in MCP mode.

### Use an in-built agent

```json title=".cursor/mcp.json"
{
  "mcpServers": {
    "dexto": {
      "command": "dexto",
      "args": ["--mode", "mcp", "--agent", "music-agent", "--auto-approve"]
    }
  }
}
```

```json title=".cursor/mcp.json (just dexto section)"
"dexto": {
  "command": "dexto",
  "args": ["--mode", "mcp", "--agent", "music-agent", "--auto-approve"]
}
```

Replace `music-agent` with any of the agents you see in `dexto list-agents`

### Expose a custom agent

Point Cursor at a custom agent file to tailor the available tools:

```json title=".cursor/mcp.json"
{
  "mcpServers": {
    "dexto": {
      "command": "npx",
      "args": [
        "-y", "dexto", "--mode", "mcp", "--agent", "<path_to_your_custom_agent.yml>"
      ]
    }
  }
}
```

```json title=".cursor/mcp.json (just dexto section)"
"dexto": {
  "command": "npx",
  "args": [
    "-y", "dexto", "--mode", "mcp", "--agent", "<path_to_your_custom_agent.yml>"
  ]
}
```

After editing, Cursor automatically connects to Dexto and exposes the tools defined by your agent (filesystem browsing, web search, custom MCP servers, etc.).

## Working with the agent

Once connected, use Cursor's MCP panel or chat to run tools such as `chat_with_agent`:

- **Code improvements:** “Ask Dexto agent to refactor the highlighted function for performance.”
- **Project analysis:** “Ask Dexto agent to explain the current architecture.”
- **Web research:** “Ask Dexto agent to find the latest React 19 release notes.”

<p class="lightbox-gallery">
  <a href="#cursor-dexto-screenshot" class="lightbox-thumb">
    <img src="/img/cursor/dexto-agent-cursor.png" alt="Cursor running a Dexto MCP agent" />
  </a>
</p>

<div id="cursor-dexto-screenshot" class="lightbox-target">
  <img src="/img/cursor/dexto-agent-cursor.png" alt="Cursor running a Dexto MCP agent" />
  <a class="lightbox-close" href="#"></a>
</div>

Combine this with your own agent configuration to enable domain-specific workflows—everything from documentation search to infrastructure automation.



## Troubleshooting

- **Credentials not found:** rerun `dexto setup` to enter provider keys; Dexto persists them inside `~/.dexto`.
- **Need verbose logs:** start the MCP server yourself with `DEXTO_LOG_LEVEL=debug dexto --mode mcp` before launching Cursor.

For more detail on other MCP transports and remote deployments, see [Using Dexto as an MCP Server](../mcp/dexto-as-mcp-server.md).
