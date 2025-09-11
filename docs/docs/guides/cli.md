---
sidebar_position: 2

---

# CLI Guide

This guide helps you get started with the Dexto CLI and includes a comprehensive list of commands you can run with Dexto CLI.

Dexto CLI is the easiest way to get started with AI agents.

Some of the cool things you can do with Dexto CLI:

- Talk to any LLM in your terminal
- Create long-lived AI agents with tools, knowledge and memories. Example: a productivity agent that integrates with your linear and github.
- Deploy these agents either locally or on the cloud
- Talk to these agents on any application - discord, telegram, slack, cursor, claude desktop, etc.
- Start building your own AI applications - get started with building your own Cursor! `dexto create-app`


## Complete CLI Reference

### Main Commands & Options

| Command | Description | Example |
|---------|-------------|---------|
| `dexto` | Start interactive CLI | `dexto` |
| `dexto "prompt"` | Run single prompt | `dexto "list files here"` |
| `dexto -p "prompt"` | Run single prompt (explicit) | `dexto -p "create a file"` |
| `dexto --mode web` | Launch web UI | `dexto --mode web --web-port 8080` |
| `dexto --mode server` | Start as API server | `dexto --mode server` |
| `dexto --mode mcp` | Run as MCP server | `dexto --mode mcp` |
| `dexto --mode discord` | Start Discord bot | `dexto --mode discord` |
| `dexto --mode telegram` | Start Telegram bot | `dexto --mode telegram` |

### CLI Flags & Options

| Flag | Description | Example |
|------|-------------|---------|
| `-v, --version` | Show version | `dexto --version` |
| `-a, --agent <path>` | Use custom agent config | `dexto -a ./my-agent.yml` |
| `-m, --model <model>` | Specify LLM model | `dexto -m claude-4-sonnet-20250514` |
| `-r, --router <router>` | Specify router (vercel/in-built) | `dexto -r in-built` |
| `--new-session [id]` | Start new session | `dexto --new-session my-session` |
| `--strict` | Require all MCP servers to connect | `dexto --strict` |
| `--no-verbose` | Disable verbose output | `dexto --no-verbose` |
| `--no-interactive` | Disable prompts/setup | `dexto --no-interactive` |
| `--no-auto-install` | Disable auto agent install | `dexto --no-auto-install` |
| `--web-port <port>` | Web UI port | `dexto --mode web --web-port 3001` |

### Subcommands

| Command | Description | Example |
|---------|-------------|---------|
| `create-app` | Scaffold new Dexto TypeScript app | `dexto create-app` |
| `init-app` | Add Dexto to existing TypeScript app | `dexto init-app` |
| `setup` | Configure global preferences | `dexto setup` |
| `install [agents...]` | Install agents from registry | `dexto install nano-banana-agent` |
| `uninstall [agents...]` | Uninstall local agents | `dexto uninstall nano-banana-agent` |
| `list-agents` | List available/installed agents | `dexto list-agents --installed` |
| `which <agent>` | Show path to agent | `dexto which nano-banana-agent` |
| `mcp --group-servers` | Start MCP server aggregator | `dexto mcp --group-servers` |

### Interactive CLI Commands

Once in interactive mode (`dexto`), use these slash commands:

| Command | Description | Example |
|---------|-------------|---------|
| `/help [command]` | Show help information | `/help session` |
| `/exit, /quit, /q` | Exit CLI | `/exit` |
| `/clear, /reset` | Clear conversation history | `/clear` |
| `/session list` | List all sessions | `/session list` |
| `/session create [id]` | Create new session | `/session create work-session` |
| `/session load <id>` | Load session | `/session load work-session` |
| `/session delete <id>` | Delete session | `/session delete old-session` |
| `/session export <id>` | Export session data | `/session export work-session` |
| `/history [limit]` | Show conversation history | `/history 10` |
| `/search <query>` | Search conversation history | `/search "code review"` |
| `/model list` | List available models | `/model list` |
| `/model switch <model>` | Switch LLM model | `/model switch gpt-4o` |
| `/model current` | Show current model | `/model current` |
| `/mcp list` | List MCP servers | `/mcp list` |
| `/mcp connect <name>` | Connect MCP server | `/mcp connect filesystem` |
| `/mcp disconnect <name>` | Disconnect MCP server | `/mcp disconnect web` |
| `/mcp status` | Show connection status | `/mcp status` |
| `/tools list` | List available tools | `/tools list` |
| `/tools search <query>` | Search tools | `/tools search file` |
| `/prompt show` | Show current system prompt | `/prompt show` |
| `/prompt reload` | Reload system prompt | `/prompt reload` |
| `/log level <level>` | Set log level | `/log level debug` |
| `/log tail [lines]` | Show recent logs | `/log tail 50` |
| `/config validate` | Validate configuration | `/config validate` |
| `/config reload` | Reload configuration | `/config reload` |
| `/stats` | Show system statistics | `/stats` |

## Common Usage Patterns

#### **See all available options and flags:**

```bash
dexto --help
```

#### **Launch the interactive CLI:**
```bash
dexto
```

#### **Start dexto CLI with a different LLM**
```bash
# openai
dexto -m gpt-4o

# anthropic
dexto -m claude-4-sonnet-20250514

# google
dexto -m gemini-2.0-flash
```


#### **Start dexto with a different config file**

This allows you to configure dexto CLI to use a different AI agent
```bash
dexto --agent <path_to_agent_config_file>
```

Check [Configuration Guide](./configuring-dexto/overview) to understand more about dexto config files

#### **Require all MCP servers to connect successfully**

By default, Dexto uses "lenient" mode where individual servers can fail to connect without preventing startup. Use the `--strict` flag to require all servers to connect successfully:

```bash
dexto --strict
```

This overrides any individual `connectionMode` settings in your MCP server configurations. See [MCP Configuration](../mcp/connecting-servers) for more details on connection modes.

#### **Run a specific command with Dexto CLI:**

```bash
dexto "find all .sh files in this directory"
# or use explicit -p flag
dexto -p "find all .sh files in this directory"
```

or do the same with gemini:

```bash
dexto -m gemini-2.0-flash "find all files in this directory"
# or with explicit -p flag
dexto -m gemini-2.0-flash -p "find all files in this directory"
```

Dexto CLI can accept __any__ command - if it doesn't see it as an in-built command, it will fire a single run CLI with that request

For instance, in the above command, the query "find all .sh files in this directory" will start Dexto Agent, send it this query, process the response, and then exit.


#### **Start a telegram bot**

```bash
dexto --mode telegram
```
To use a specific agent config file for the telegram bot:
```bash
dexto --mode telegram --agent ./telegram-agent-config.yml
```

<!-- Todo: add telegram demo -->

#### **Start a discord bot**
```bash
dexto --mode discord
```
To use a specific agent config file for the discord bot:
```bash
dexto --mode discord --agent ./discord-agent-config.yml
```

<!-- Todo: add discord demo -->

#### **Start dexto as an MCP server**
```bash
dexto --mode mcp
```

With this, you can now connect this agent to Cursor, claude desktop, or even other Dexto agents!

Check [Using dexto as an MCP Server](../mcp/dexto-as-mcp-server) to understand more about MCP servers.

#### **Group MCP servers with dexto**
```bash
dexto mcp --group-servers
```

This starts Dexto as an MCP server that aggregates and re-exposes tools from multiple configured MCP servers. This is useful when you want to access tools from multiple MCP servers through a single connection.

To use a specific config file:
```bash
dexto mcp --group-servers -a ./dexto-tools.yml
```

Check [Using Dexto to group MCP servers](../mcp/grouping-servers) to understand more about MCP server aggregation.


#### **Change log level for dexto CLI**

To change the logging level, set environment variable `DEXTO_LOG_LEVEL` to 'info', 'debug', or 'silly'. Default is 'info'.

ex: for debug logs:
```bash
DEXTO_LOG_LEVEL=debug
dexto what is the time
```


## Project setup commands

These commands will help you get started creating your own AI application using Dexto

Setup a fresh typescript project using dexto-core
```bash
dexto create-app
```

Add dexto into an existing typescript project
```bash
dexto init-app
```

Check [Building with Dexto Guide](../tutorials/index.md) for more information!

## Agent Management

### Install Pre-built Agent Templates

Dexto provides ready-to-use agent templates from the registry:

```bash
# List available agents
dexto list-agents

# Install specific agents
dexto install nano-banana-agent podcast-agent database-agent

# Use an installed agent
dexto --agent nano-banana-agent "create a futuristic cityscape"
dexto --agent podcast-agent "generate a podcast intro"

# Find where an agent is installed
dexto which nano-banana-agent

# Remove agents you no longer need
dexto uninstall nano-banana-agent
```

### Available Agent Templates
- **Nano Banana Agent** – Advanced image generation and editing using Google's Nano Banana (Gemini 2.5 Flash Image)
- **Podcast Agent** – Advanced podcast generation using Google Gemini TTS for multi-speaker audio content
- **Database Agent** – Demo agent for SQL queries and database operations
- **Image Editor Agent** – Image editing and manipulation  
- **Music Agent** – Music creation and audio processing
- **PDF Agent** – Document analysis and conversation
- **Product Researcher** – Product naming and branding research
- **Triage Agent** – Demo multi-agent customer support routing system

See the full list with `dexto list-agents` and examples in the [`agents/`](https://github.com/truffle-ai/dexto/tree/main/agents) folder.

## Coming soon!

#### Deploy config files as AI agents with dexto CLI
