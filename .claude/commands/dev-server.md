---
description: "Start the Dexto development server with optional agent file selection"
allowed-tools: ["bash", "glob"]
---

# Dev Server Launcher

Starts the Dexto development servers (API + WebUI) with optional agent configuration.

## What It Does

1. Builds core and CLI packages
2. Starts API server on port 3001
3. Starts WebUI dev server on port 3000 with hot reload
4. Allows selecting a custom agent configuration file

## Usage

### Quick Start (Default Agent)
```bash
/dev-server
```

### With Custom Agent
```bash
/dev-server --agent agents/music-agent/music-agent.yml
```

## Workflow

When you run `/dev-server`, I will:

1. **Find Available Agent Files**
   - Scan the project for `*.agent.yml` files
   - List common agent configurations

2. **Ask for Your Preference**
   - Default agent (agents/default-agent.yml)
   - Or select from available agents

3. **Start the Server**
   - Run `pnpm dev` for default agent
   - Run `pnpm dev -- --agent <path>` for custom agent

## Available Agents

The project includes several pre-configured agents:

- `agents/default-agent.yml` - Standard agent with basic tools
- `agents/music-agent/music-agent.yml` - Music creation and editing
- `agents/image-editor-agent/image-editor-agent.yml` - Image manipulation
- `agents/database-agent/database-agent.yml` - Database operations
- `agents/github-agent/github-agent.yml` - GitHub integration
- `agents/talk2pdf-agent/talk2pdf-agent.yml` - PDF analysis
- `examples/resources-demo-server/agent.yml` - Resources demo

And many more in the `agents/` directory!

## Server Details

Once started, you'll have:
- **API Server**: http://localhost:3001 (from dist build)
- **WebUI**: http://localhost:3000 (hot reload enabled)

Press `Ctrl+C` to stop all servers.

## Notes

- The dev server rebuilds core and CLI packages automatically
- WebUI runs in dev mode with hot reload for rapid development
- Agent configuration is loaded at startup
- Changes to agent.yml require server restart
- Code changes to core/CLI require full rebuild (stop and restart dev server)
- WebUI changes reload automatically

## Examples

```bash
# Use default agent
/dev-server

# Test music agent
/dev-server --agent agents/music-agent/music-agent.yml

# Test custom agent from examples
/dev-server --agent examples/resources-demo-server/agent.yml

# Development workflow with triage agent
/dev-server --agent agents/triage-demo/triage-agent.yml
```
