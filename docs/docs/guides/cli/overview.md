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
- Talk to these agents on any application - build custom integrations with discord, telegram, slack, etc.
- Start building your own AI applications - get started with building your own Cursor! `dexto create-app`

## Main Command

### Basic Usage

```bash
# Start interactive session (opens Web UI by default)
dexto

# Start interactive CLI mode
dexto --mode cli

# Run a single prompt (auto-uses CLI mode)
dexto "list files here"
dexto -p "create a snake game"

# Start as API server
dexto --mode server

# Run as MCP server
dexto --mode mcp
```

:::tip Mode Auto-Detection
`dexto` opens the Web UI by default. When you provide a prompt via `-p` or as a positional argument, Dexto automatically switches to CLI mode for one-shot execution.
:::

### Main Command Options

| Flag | Description | Example |
|------|-------------|---------|
| `-v, --version` | Show version | `dexto --version` |
| `-a, --agent <id\|path>` | Use agent ID or path to config file | `dexto -a nano-banana-agent` |
| `-p, --prompt <text>` | Run single prompt and exit | `dexto -p "list files"` |
| `-m, --model <model>` | Specify LLM model | `dexto -m gpt-5-mini` |
| `-c, --continue` | Continue most recent conversation | `dexto -c` |
| `-r, --resume <sessionId>` | Resume a specific session by ID | `dexto --resume my-session` |
| `--mode <mode>` | Run mode (web/cli/server/mcp, default: web) | `dexto --mode cli` |
| `--port <port>` | Server port (default: 3000 for web, 3001 for server mode) | `dexto --port 8080` |
| `--skip-setup` | Skip initial setup prompts | `dexto --skip-setup` |
| `-s, --strict` | Require all MCP servers to connect | `dexto --strict` |
| `--no-verbose` | Disable verbose output | `dexto --no-verbose` |
| `--no-interactive` | Disable prompts/setup | `dexto --no-interactive` |
| `--no-auto-install` | Disable auto agent install | `dexto --no-auto-install` |
| `--auto-approve` | Auto-approve all tool executions | `dexto --auto-approve` |

**Note:** The `-a, --agent` flag accepts both agent IDs from the registry and paths to agent config files. See the [Agent Registry](/docs/guides/agent-registry) for available agents.

## Subcommands

### `create-app` - Scaffold New TypeScript App

Create a new Dexto TypeScript application from scratch.

```bash
dexto create-app
```

This command will:
1. Create project structure
2. Set up TypeScript configuration
3. Prompt for LLM provider and API keys
4. Install dependencies
5. Generate example files

### `init-app` - Initialize Existing TypeScript App

Add Dexto to an existing TypeScript project.

```bash
dexto init-app
```

**Requirements:**
- Must have `package.json` and `tsconfig.json` in current directory

### `setup` - Configure Global Preferences

Configure global Dexto preferences including default LLM provider, model, and agent.

```bash
dexto setup
dexto setup --provider openai --model gpt-5-mini
dexto setup --force
```

**Options:**
- `--provider <provider>` - LLM provider (openai, anthropic, google, groq, xai, cohere)
- `--model <model>` - Model name (uses provider default if not specified)
- `--default-agent <agent>` - Default agent name (default: coding-agent)
- `--force` - Overwrite existing setup without confirmation
- `--no-interactive` - Skip interactive prompts

See [Global Preferences](./global-preferences) for detailed configuration guide.

### `install` - Install Agents

Install agents from the registry or custom YAML files/directories.

```bash
# Install single agent from registry
dexto install nano-banana-agent

# Install multiple agents
dexto install podcast-agent coding-agent database-agent

# Install all available agents
dexto install --all

# Install custom agent from file
dexto install ./my-agent.yml

# Install from directory (interactive)
dexto install ./my-agent-dir/
```

**Options:**
- `--all` - Install all available agents from registry
- `--force` - Force reinstall even if agent is already installed
- `--no-inject-preferences` - Skip injecting global preferences into installed agents

See the [Agent Registry](/docs/guides/agent-registry) for available agents.

### `uninstall` - Uninstall Agents

Remove agents from your local installation.

```bash
# Uninstall single agent
dexto uninstall nano-banana-agent

# Uninstall multiple agents
dexto uninstall agent1 agent2

# Uninstall all agents
dexto uninstall --all
```

**Options:**
- `--all` - Uninstall all installed agents
- `--force` - Force uninstall even if agent is protected (e.g., coding-agent)

### `sync-agents` - Sync Agent Configs

Sync installed agents with bundled versions after Dexto updates.

```bash
# Check status and prompt for updates
dexto sync-agents

# List what would change (dry run)
dexto sync-agents --list

# Force update all without prompts
dexto sync-agents --force
```

**Options:**
- `--list` - Show status without making changes
- `--force` - Update all agents without confirmation

**When to use:** When Dexto shows "Agent updates available" notification after an update, or when you want to reset agents to their default configurations.

### `list-agents` - List Available Agents

List agents from the registry and locally installed agents.

```bash
# List all agents (registry + installed)
dexto list-agents

# Show only installed agents
dexto list-agents --installed

# Show only registry agents
dexto list-agents --available

# Show detailed information
dexto list-agents --verbose
```

**Options:**
- `--verbose` - Show detailed agent information
- `--installed` - Show only installed agents
- `--available` - Show only available agents from registry

See the [Agent Registry](/docs/guides/agent-registry) for detailed agent information.

### `which` - Show Agent Path

Display the path to a specific agent's configuration file.

```bash
dexto which nano-banana-agent
dexto which coding-agent
```

### `session` - Manage Sessions

Manage conversation sessions.

#### `session list`

List all available sessions.

```bash
dexto session list
```

#### `session history`

Show message history for a session.

```bash
# Show history for current session
dexto session history

# Show history for specific session
dexto session history my-session-id
```

#### `session delete`

Delete a specific session.

```bash
dexto session delete old-session-id
```

### `search` - Search Session History

Search across all conversation messages in session history.

```bash
# Search all sessions
dexto search "bug fix"

# Search in specific session
dexto search "error" --session my-session

# Filter by role
dexto search "help" --role assistant

# Limit results
dexto search "code" --limit 20
```

**Options:**
- `--session <sessionId>` - Search in specific session only
- `--role <role>` - Filter by role (user, assistant, system, tool)
- `--limit <number>` - Limit number of results (default: 10)

### `mcp` - MCP Server Mode

Start Dexto as an MCP server to aggregate and re-expose tools from configured MCP servers.

```bash
# Start MCP tool aggregation server
dexto mcp --group-servers

# Start in strict mode
dexto mcp --group-servers --strict
```

**Options:**
- `--group-servers` - Aggregate and re-expose tools from configured MCP servers
- `-s, --strict` - Require all MCP server connections to succeed
- `--name <name>` - MCP server name (default: 'dexto-tools')
- `--version <version>` - MCP server version (default: '1.0.0')

**Note:** In the future, `dexto --mode mcp` will be moved to this subcommand to expose the agent as an MCP server by default.

## Interactive CLI Commands

Once in interactive mode (`dexto`), use these slash commands:

### Help & Navigation

| Command | Description |
|---------|-------------|
| `/help [command]` | Show help information for commands |
| `/docs, /doc` | Open Dexto documentation in browser |
| `/exit, /quit, /q` | Exit the CLI |

### Conversation Management

| Command | Description |
|---------|-------------|
| `/clear, /reset` | Clear current conversation history |
| `/history` | Show current session history |

### Session Management

| Command | Description |
|---------|-------------|
| `/session list` | List all available sessions |
| `/session history [sessionId]` | Show history for a session |
| `/session delete <sessionId>` | Delete a specific session |

### Search

| Command | Description |
|---------|-------------|
| `/search <query>` | Search across conversation history |

### Model Management

| Command | Description |
|---------|-------------|
| `/model list` | List all available LLM models |
| `/model switch <model>` | Switch to a different LLM model |
| `/model current` | Show currently active model |

### MCP Server Management

| Command | Description |
|---------|-------------|
| `/mcp list` | List connected MCP servers |
| `/mcp add stdio <name> <cmd> [args...]` | Add stdio MCP server |
| `/mcp add http <name> <url>` | Add HTTP MCP server |
| `/mcp add sse <name> <url>` | Add SSE MCP server |
| `/mcp remove <name>` | Remove MCP server |

### Tool Management

| Command | Description |
|---------|-------------|
| `/tools list` | List all available tools from MCP servers |
| `/tools search <query>` | Search for specific tools |

### Prompts

| Command | Description |
|---------|-------------|
| `/prompts` | List all available prompts (custom + MCP) |
| `/use <prompt> [args]` | Execute a specific prompt template |
| `/<prompt-name> [args]` | Direct prompt execution shorthand |

### Configuration

| Command | Description |
|---------|-------------|
| `/sysprompt` | Display current system prompt |
| `/config validate` | Validate current configuration |
| `/config reload` | Reload configuration from file |

### Logging

| Command | Description |
|---------|-------------|
| `/log level <level>` | Set log level (debug, info, warn, error) |
| `/log tail [lines]` | Show recent log entries (default: 20 lines) |

### Statistics

| Command | Description |
|---------|-------------|
| `/stats` | Show system statistics (token usage, sessions, etc.) |

## Common Usage Patterns

### Quick Start

```bash
# Interactive session with default settings (opens Web UI)
dexto

# Interactive CLI mode
dexto --mode cli

# Use a specific agent (opens Web UI)
dexto --agent nano-banana-agent

# Start with a specific model (opens Web UI)
dexto -m claude-sonnet-4-5-20250929
```

### One-Shot Prompts

```bash
# Run single task and exit (auto-uses CLI mode)
dexto "list all TypeScript files in src/"
dexto -p "create a README for this project"

# With auto-approve for automation
dexto --auto-approve "format all JavaScript files"

# With specific agent
dexto --agent coding-agent "create a landing page for my coffee shop"

# Combine agent, model, and auto-approve
dexto --agent coding-agent -m gpt-5 --auto-approve "build a todo app with React"
```

### Session Continuation

```bash
# Continue most recent conversation (opens Web UI)
dexto --continue

# Continue in CLI mode
dexto --continue --mode cli

# Continue with a one-shot prompt, then exit
dexto -c -p "now add error handling"

# Resume specific session (opens Web UI)
# Get session id from the web UI or session list command
dexto --resume my-project-session

# Resume session in CLI mode
dexto --resume my-project-session --mode cli

# Resume and run a one-shot prompt
dexto -r my-project-session "fix the bug we discussed"
```

### Agent Management

```bash
# Install agents for specific use cases
dexto install podcast-agent music-agent coding-agent

# Install all available agents
dexto install --all

# List what's installed
dexto list-agents --installed

# Find agent config location
dexto which coding-agent

# Use custom agent file
dexto --agent ./agents/my-custom-agent.yml
```

### Web UI

```bash
# Launch on default port (3000)
dexto

# Custom port
dexto --port 8080

# With specific agent
dexto --agent database-agent
```

### API Server

```bash
# Start REST + SSE streaming server (default port 3001)
dexto --mode server

# With custom port
dexto --mode server --port 8080

# With specific agent and strict mode
dexto --mode server --agent my-agent --strict

# For production with custom agent
dexto --mode server --agent ./production-agent.yml --port 3001
```

### Content Generation

```bash
# Generate podcast content
dexto --agent podcast-agent "create a 5-minute podcast about space exploration"

# Generate images
dexto --agent nano-banana-agent "create a futuristic cityscape"

# Create code with specific instructions
dexto --agent coding-agent "build a REST API with Express and TypeScript"

# Interactive mode for complex tasks
dexto --agent coding-agent
# Then in the UI: "Let's build a full-stack app step by step"
```

### Automation & CI/CD

```bash
# Automated code review (no confirmation prompts)
dexto --auto-approve "review all files in src/ and suggest improvements"

# Generate documentation
dexto --auto-approve "create API documentation from the code in src/api/"

# Run tests and analyze results
dexto "run the test suite and explain any failures"

# Git commit message generation
git diff | dexto -p "generate a conventional commit message for these changes"
```

### Multi-Agent Workflows

```bash
# Start researcher agent as MCP server (Terminal 1)
dexto --mode mcp --port 4000 --agent researcher-agent

# Start coordinator agent that uses researcher (Terminal 2)
dexto --agent coordinator-agent --port 5000
```

### Search & History

```bash
# Search all conversations
dexto search "database schema"

# Search in specific session
dexto search "bug fix" --session my-session-id

# Filter by role
dexto search "error" --role assistant

# View session history
dexto session history my-session-id
```

## Next Steps

- **[Global Preferences](./global-preferences)** - Configure default settings
- **[Agent Registry](/docs/guides/agent-registry)** - Browse available agents
- **[Agent Configuration](/docs/guides/configuring-dexto/overview)** - Create custom agents
- **[MCP Integration](/docs/mcp/overview)** - Connect external tools and services
