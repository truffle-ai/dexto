---
sidebar_position: 1
title: "Overview"
---

# CLI Overview

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
| `-m, --model <model>` | Specify LLM model | `dexto -m claude-sonnet-4-5-20250929` |
| `--router <router>` | Specify router (vercel/in-built) | `dexto --router in-built` |
| `-c, --continue` | Continue the last session | `dexto --continue` |
| `-r, --resume <sessionId>` | Resume a specific session by ID | `dexto --resume my-session` |
| `--skip-setup` | Skip initial setup prompts | `dexto --skip-setup` |
| `-s, --strict` | Require all MCP servers to connect | `dexto --strict` |
| `--no-verbose` | Disable verbose output | `dexto --no-verbose` |
| `--no-interactive` | Disable prompts/setup | `dexto --no-interactive` |
| `--no-auto-install` | Disable auto agent install | `dexto --no-auto-install` |
| `--auto-approve` | Auto-approve all tool executions | `dexto --auto-approve -p "format my repo"` |
| `--web-port <port>` | Web UI port | `dexto --mode web --web-port 3001` |

### Subcommands

| Command | Description | Example |
|---------|-------------|---------|
| `create-app` | Scaffold new Dexto TypeScript app | `dexto create-app` |
| `init-app` | Add Dexto to existing TypeScript app | `dexto init-app` |
| `setup` | Configure global preferences | `dexto setup` |

See [Global Preferences](./global-preferences.md) for detailed configuration guide.

**Options:**
- `--provider <provider>` - LLM provider to configure
- `--model <model>` - LLM model to use
- `--default-agent <agent>` - Set default agent
- `--force` - Force reconfiguration even if already set up
- `--no-interactive` - Run in non-interactive mode

| `install [agents...]` | Install agents from registry | `dexto install nano-banana-agent` |

**Options:**
- `--all` - Install all available agents from registry
- `--no-inject-preferences` - Skip injecting global preferences into agent config
- `--force` - Force reinstall even if already installed

| `uninstall [agents...]` | Uninstall local agents | `dexto uninstall nano-banana-agent` |

**Options:**
- `--all` - Uninstall all agents
- `--force` - Force uninstall without confirmation

| `list-agents` | List available/installed agents | `dexto list-agents --installed` |

**Options:**
- `--verbose` - Show detailed agent information
- `--installed` - Show only installed agents
- `--available` - Show only registry agents (not installed locally)

| `which <agent>` | Show path to agent | `dexto which nano-banana-agent` |
| `session list` | List all sessions | `dexto session list` |
| `session history [sessionId]` | Show session history | `dexto session history my-session` |
| `session delete <sessionId>` | Delete a session | `dexto session delete old-session` |
| `search <query>` | Search session history | `dexto search "code review"` |

**Options for `search`:**
- `--session <sessionId>` - Search in specific session
- `--role <role>` - Filter by role (user, assistant, system, tool)
- `--limit <number>` - Limit number of results (default: 10)

| `mcp --group-servers` | Start MCP server aggregator | `dexto mcp --group-servers` |

**Options:**
- `-s, --strict` - Run in strict mode
- `--name <name>` - MCP server name (default: 'dexto-tools')
- `--version <version>` - MCP server version (default: '1.0.0')

### Interactive CLI Commands

Once in interactive mode (`dexto`), use these slash commands:

| Command | Description | Example |
|---------|-------------|---------|
| `/help [command]` | Show help information | `/help session` |
| `/exit, /quit, /q` | Exit CLI | `/exit` |
| `/clear, /reset` | Clear conversation history | `/clear` |
| `/session list` | List all sessions | `/session list` |
| `/session history [sessionId]` | Show session history | `/session history` |
| `/session delete <sessionId>` | Delete a session | `/session delete old-session` |
| `/history` | Show current session history | `/history` |
| `/search <query>` | Search conversation history | `/search "code review"` |
| `/model list` | List available models | `/model list` |
| `/model switch <model>` | Switch LLM model | `/model switch gpt-5` |
| `/model current` | Show current model | `/model current` |
| `/mcp list` | List MCP servers | `/mcp list` |
| `/mcp add stdio <name> <cmd> [args...]` | Add stdio MCP server | `/mcp add stdio fs npx -y @modelcontextprotocol/server-filesystem` |
| `/mcp add http <name> <url>` | Add HTTP MCP server | `/mcp add http myserver http://localhost:3000` |
| `/mcp add sse <name> <url>` | Add SSE MCP server | `/mcp add sse events http://localhost:3000/events` |
| `/mcp remove <name>` | Remove MCP server | `/mcp remove filesystem` |
| `/tools list` | List available tools | `/tools list` |
| `/tools search <query>` | Search tools | `/tools search file` |
| `/sysprompt` | Display current system prompt | `/sysprompt` |
| `/prompts` | List all available prompts | `/prompts` |
| `/use <prompt> [args]` | Use a specific prompt | `/use code-review language=js` |
| `/<prompt-name> [args]` | Direct prompt execution | `/code-review some-file.js` |
| `/docs, /doc` | Open Dexto documentation | `/docs` |
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
dexto -m gpt-5-mini

# anthropic
dexto -m claude-sonnet-4-5-20250929

# google
dexto -m gemini-2.5-flash
```


#### **Start dexto with a different config file**

This allows you to configure dexto CLI to use a different AI agent
```bash
dexto --agent <path_to_agent_config_file>
```

Check [Configuration Guide](../configuring-dexto/overview.md) to understand more about dexto config files

#### **Require all MCP servers to connect successfully**

By default, Dexto uses "lenient" mode where individual servers can fail to connect without preventing startup. Use the `--strict` flag to require all servers to connect successfully:

```bash
dexto --strict
```

This overrides any individual `connectionMode` settings in your MCP server configurations. See [MCP Overview](../mcp/overview.md) for more details on connection modes.

#### **Skip tool confirmation prompts during development**

```bash
dexto --auto-approve "refactor my project using the filesystem and browser tools"
```

Use the `--auto-approve` flag when you trust the tools being triggered and want to bypass interactive confirmation prompts. This flag overrides the `toolConfirmation.mode` defined in your agent config for the current run only.

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

Check [Dexto Agents as MCP Servers](../mcp/dexto-as-mcp-server.md) to understand more about MCP servers.

#### **Group MCP servers with dexto**
```bash
dexto mcp --group-servers
```

This starts Dexto as an MCP server that aggregates and re-exposes tools from multiple configured MCP servers. This is useful when you want to access tools from multiple MCP servers through a single connection.

To use a specific config file:
```bash
dexto mcp --group-servers -a ./dexto-tools.yml
```

Check [Using Dexto to group MCP servers](../mcp/dexto-group-mcp-servers.md) to understand more about MCP server aggregation.


## Environment variables

Dexto reads settings from the layered environment loader (`process.env`, `.env`, `.dexto/.env`). After you run `dexto setup`, your LLM credentials live in `~/.dexto/.env`, so you rarely need to touch these variables unless you are customizing runtime behaviour.

### General runtime controls

| Variable | Default | Purpose |
| --- | --- | --- |
| `DEXTO_LOG_LEVEL` | `info` | Controls log verbosity (`error`, `warn`, `info`, `debug`, `silly`). |
| `DEXTO_LOG_TO_CONSOLE` | `false` | Force console logging even when logs are redirected to file (set to `true`). |
| `DEXTO_ANALYTICS_DISABLED` | `false` | Opt out of analytics when truthy (`1`, `true`, `yes`). |

### Analytics overrides

| Variable | Default | Purpose |
| --- | --- | --- |
| `DEXTO_POSTHOG_KEY` | Built-in public key | Supply a custom PostHog project key. |
| `DEXTO_POSTHOG_HOST` | `https://app.posthog.com` | Point analytics to a self-hosted PostHog instance. |

### Web UI & server configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOSTNAME` | `0.0.0.0` | Hostname used when launching the Web UI. |
| `FRONTEND_PORT` | `3000` | Overrides the Next.js port when running `--mode web`. |
| `PORT` | `3000` | Fallback port used by the API server if `API_PORT` is not set. |
| `API_PORT` | `3001` | Controls the REST/WebSocket API port for web/server modes. |
| `API_URL` | `http://localhost:<API_PORT>` | Overrides the API base URL passed to the Web UI. |
| `FRONTEND_URL` | `http://localhost:<FRONTEND_PORT>` | Overrides the URL opened in the browser when the Web UI starts. |
| `NEXT_PUBLIC_API_URL` | Derived from `API_URL` | Injects a custom API URL into the Web UI bundle. |
| `NEXT_PUBLIC_WS_URL` | `ws://localhost:<API_PORT>` | Injects a custom WebSocket URL into the Web UI bundle. |
| `NEXT_PUBLIC_FRONTEND_URL` | Derived from `FRONTEND_URL` | Injects a custom frontend URL into the Web UI bundle. |
| `DEXTO_BASE_URL` | `http://localhost:<PORT>` | Base URL used by the REST server when generating absolute links. |
| `DEXTO_MCP_TRANSPORT_TYPE` | `http` | Switch between `http` and `stdio` transports for the MCP aggregation server. |

### Discord integration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DISCORD_BOT_TOKEN` | — | Required to enable `--mode discord`. |
| `DISCORD_RATE_LIMIT_ENABLED` | `true` | Disable Discord rate limiting by setting to `false`. |
| `DISCORD_RATE_LIMIT_SECONDS` | `5` | Cooldown window for rate limiting in seconds. |

### Telegram integration

| Variable | Default | Purpose |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | — | Required to enable `--mode telegram`. |
| `TELEGRAM_INLINE_QUERY_CONCURRENCY` | `4` | Maximum concurrent inline queries handled by the bot. |

#### Change log level on the fly

```bash
DEXTO_LOG_LEVEL=debug dexto what is the time
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

<!-- TODO: Document interactive CLI commands (/help, /session, /model, /mcp, /tools, /sysprompt, /prompts, /log, /config, /stats, /docs, /search, /history, /clear, /exit) -->
