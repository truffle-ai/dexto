---
sidebar_position: 1
title: "Overview"
---

# CLI Overview

The Dexto CLI provides two ways to interact with AI agents:

| Mode | What It Is | How to Use |
|------|------------|------------|
| **CLI Tool** | Terminal commands for managing agents, sessions, and configuration | `dexto agents install`, `dexto setup`, `dexto agents list` |
| **Interactive Mode** | Chat session with slash commands for real-time control | `/model switch`, `/mcp add`, `/search` |

This guide covers the **CLI Tool** commands. For slash commands available during chat, see [Interactive Commands](./interactive-commands.md).

## What You Can Do

- Talk to any LLM in your terminal or browser
- Create long-lived AI agents with tools, knowledge, and memories
- Turn any folder into a Dexto workspace with authored agents and skills
- Deploy agents locally or on the cloud
- Build custom integrations with Discord, Telegram, Slack, etc.
- Scaffold new AI applications with `dexto create-app`

---

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
| `--permissions-mode` | Select `manual` or `auto-approve` in TUI or headless mode | `dexto --permissions-mode manual` |
| `--auto-approve` / `--bypass-permissions` | Select `auto-approve`; mandatory approvals still apply | `dexto --auto-approve` |

**Note:** The `-a, --agent` flag accepts both agent IDs from the registry and paths to agent config files. See the [Agent Registry](/docs/guides/agent-registry) for available agents.

## Subcommands

### `run` - Run a Headless Task

Use `dexto run "your task"` for a non-interactive task. It prints the reply at a terminal and one JSON result otherwise; `--json`, `--stream-json` and `--text` choose explicitly. See [Headless Tasks](./headless-tasks.md) for the output contract.

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

### `init` - Initialize a Dexto Workspace

Turn the current folder into a Dexto workspace with visible authored folders for agents and skills.

```bash
# Initialize the current folder
dexto init

# Create a workspace agent (interactive if you omit the id)
dexto init agent
dexto init agent review-agent

# Create and auto-link a subagent to the current primary agent
dexto init agent explore-agent --subagent

# Set or change the workspace primary agent
dexto init primary review-agent

# Create a workspace skill
dexto init skill code-review

# Inspect the current workspace config and deploy preview
dexto init status
```

**What `dexto init` creates:**
- `AGENTS.md`
- `agents/`
- `.agents/skills/`
- `.agents/skills/create-skill/` as a starter skill bundle for authoring more skills

**What the follow-up commands do:**
- `dexto init agent` creates `agents/<id>/<id>.yml`
- The first non-subagent agent becomes the workspace primary by default
- `dexto init agent --subagent` creates a subagent and links it to the current primary agent when one exists
- `dexto init skill <id>` creates `.agents/skills/<id>/SKILL.md` plus `handlers/`, `scripts/`, `mcps/`, and `references/`
- `dexto init status` shows the current workspace structure, primary agent and skills

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

### `login` - Sign In to Dexto

Signing in is optional: signed out, Dexto runs fully locally with your own model keys.

```bash
dexto login                 # sign in with your browser
dexto login --device        # approve a code on any device (SSH, no browser)
dexto login --org acme      # sign in for an organization, saved as profile "acme"
dexto login --api-key $KEY  # save a Dexto API key, for CI
dexto whoami                # who commands act as
dexto accounts list         # saved sign-ins; * marks the one in use
dexto accounts use acme     # switch
dexto accounts remove acme  # log out and forget (asks first, or --yes)
dexto logout                # end the sign-in on the server and forget it here
```

Sign-ins are saved per profile in `~/.dexto/accounts/`, readable only by you. `--profile <name>` or `DEXTO_PROFILE` picks one for a single run, and `DEXTO_API_KEY` takes precedence over any saved sign-in. A first sign-in only reads; `--scope <permission>` asks for more and keeps what was granted before. Sign-ins from the `dexto-cloud` preview CLI are carried over once.

Signed in, every local session also gets the Dexto MCP as a server named `dexto`: your connectors, Drive, Sites and Apps, Loops and memory, beside your own MCP servers. Its tools ask first through the normal approval prompt. If Dexto is unreachable, the session still runs and those tools show as unavailable. A server you name `dexto` yourself takes its place.

### `agents install` - Install Agents

Install agents from the registry or custom YAML files/directories.

```bash
# Install single agent from registry
dexto agents install nano-banana-agent

# Install multiple agents
dexto agents install podcast-agent coding-agent database-agent

# Install all available agents
dexto agents install --all

# Install custom agent from file
dexto agents install ./my-agent.yml

# Install from directory (interactive)
dexto agents install ./my-agent-dir/
```

**Options:**
- `--all` - Install all available agents from registry
- `--force` - Force reinstall even if agent is already installed

See the [Agent Registry](/docs/guides/agent-registry) for available agents.

### `agents uninstall` - Uninstall Agents

Remove agents from your local installation.

```bash
# Uninstall single agent
dexto agents uninstall nano-banana-agent

# Uninstall multiple agents
dexto agents uninstall agent1 agent2

# Uninstall all agents
dexto agents uninstall --all
```

**Options:**
- `--all` - Uninstall all installed agents
- `--force` - Force uninstall even if agent is protected (e.g., coding-agent)

### `upgrade` - Upgrade Dexto CLI

Upgrade the Dexto CLI itself. If an older npm global install is detected, this command migrates to native installer automatically.

```bash
# Upgrade to latest
dexto upgrade

# Upgrade to a specific version
dexto upgrade 1.6.8
```

**Options:**
- `--dry-run` - Print install/migration commands without executing
- `--force` - Force reinstall for native install target

### `uninstall` - Uninstall Dexto CLI

Uninstall the Dexto CLI binary (agent removal is handled by `dexto agents uninstall`).

```bash
# Remove CLI binary only (keeps ~/.dexto)
dexto uninstall

# Preview changes
dexto uninstall --dry-run

# Also remove ~/.dexto completely
dexto uninstall --purge
```

**Options:**
- `--purge` - Remove `~/.dexto` completely
- `--dry-run` - Show what would be removed

### `agents sync` - Sync Agent Configs

Sync installed agents with bundled versions after Dexto updates.

```bash
# Check status and prompt for updates
dexto agents sync

# List what would change (dry run)
dexto agents sync --list

# Force update all without prompts
dexto agents sync --force
```

**Options:**
- `--list` - Show status without making changes
- `--force` - Update all agents without confirmation

**When to use:** When Dexto shows "Agent updates available" notification after an update, or when you want to reset agents to their default configurations.

### `agents list` - List Available Agents

List agents from the registry and locally installed agents.

```bash
# List all agents (registry + installed)
dexto agents list

# Show only installed agents
dexto agents list --installed

# Show only registry agents
dexto agents list --available

# Show detailed information
dexto agents list --verbose
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

### `chat` - Your Chats

Manage conversation sessions.

#### `chat list`

List all available sessions.

```bash
dexto chat list
```

#### `chat history`

Show message history for a session.

```bash
# Show history for current session
dexto chat history

# Show history for specific session
dexto chat history my-session-id
```

#### `chat delete`

Delete a specific session.

```bash
dexto chat delete old-session-id
```

#### `chat local` and `chat import`

Bring Claude Code and Codex chats from this machine into Dexto, signed in:

```bash
dexto chat local                 # chats Dexto can import
dexto chat import --all          # import every chat that local lists
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

---

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
# Get session id from the web UI or dexto chat list
dexto --resume my-project-session

# Resume session in CLI mode
dexto --resume my-project-session --mode cli

# Resume and run a one-shot prompt
dexto -r my-project-session "fix the bug we discussed"
```

### Agent Management

```bash
# Install agents for specific use cases
dexto agents install podcast-agent music-agent coding-agent

# Install all available agents
dexto agents install --all

# List what's installed
dexto agents list --installed

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
dexto chat history my-session-id
```

## Dexto Cloud

`dexto cloud` builds in Dexto Cloud through the public `/v1` API, as your sign-in (`dexto login`) or an API key:

```bash
dexto cloud projects list          # * marks the project you act in
dexto cloud projects use Main      # act in another project; Dexto models bill it too
dexto cloud api GET /v1/agents     # call any /v1 operation directly
```

Every cloud command takes `--json` or `--table`, `--api-key <key>`, `--profile <name>` and `--project <id>`. Output is JSON when stdout isn't a terminal, and a failure prints `{"error":{"code","message","fix"}}` on stderr, where `fix` is the command that fixes it. Exit codes: 0 done, 1 failed, 2 usage, 3 needs sign-in or permission, 4 needs `--yes` (pass it only once your person has agreed), 5 not found. A command that needs a permission your sign-in lacks offers, at a terminal, to sign in again for it.

Deploy Sites and Functions with `dexto cloud sites deploy` and `dexto cloud functions deploy`, each packed with the project's own packer. Dexto 1.x's `dexto deploy` (workspace deploys) is gone in 2.0, along with `dexto --cloud-agent`; `dexto trace` and `dexto span` are also gone until a public `/v1` traces endpoint brings them back.

## Your Dexto Workspace

Signed in, `dexto workspace` uses your workspace as you, over the Dexto MCP: the same apps and tools your agents use.

```bash
dexto workspace                            # your apps
dexto workspace drive                      # what an app does
dexto workspace drive put ./report.pdf     # upload into Drive
dexto workspace email send --to a@b.c --yes
dexto workspace tools --search calendar    # every tool, by MCP name
dexto workspace call dexto_search --data '{"query":"invoices"}'
dexto find "share a file"                  # the command for what you want to do
```

An operation that acts, approves or spends asks first; pass `--yes` only once your person has agreed (without it, and with no one to ask, the command exits 4 with the command that goes ahead). Workspace tools act as a person, so an API key can't use them. An operation your sign-in can't use yet names the `dexto login --scope` that grants it.

## Next Steps

- **[Interactive Commands](./interactive-commands)** - Slash commands for chat sessions
- **[Agent Registry](/docs/guides/agent-registry)** - Browse available agents
- **[Agent Configuration](/docs/guides/configuring-dexto/overview)** - Create custom agents
- **[MCP Integration](/docs/mcp/overview)** - Connect external tools and services
- **[Global Preferences](./global-preferences)** - Configure system-wide defaults
