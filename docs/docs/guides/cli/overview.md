---
sidebar_position: 1
title: "Overview"
---

# CLI Overview

The Dexto CLI provides two ways to interact with AI agents:

| Mode | What It Is | How to Use |
|------|------------|------------|
| **CLI Tool** | Terminal commands for chats, headless runs, your sign-in, Dexto Cloud and your workspace | `dexto run`, `dexto chat list`, `dexto login` |
| **Interactive Mode** | Chat session with slash commands for real-time control | `/model switch`, `/mcp add`, `/search` |

This guide covers the **CLI Tool** commands. For slash commands available during chat, see [Interactive Commands](./interactive-commands.md).

## Install

Node.js 20 or later works; 22 is recommended. Use npm. Install once:

```sh
npm install -g dexto
```

If npm fails with EACCES, don't use sudo; use the [install script](https://www.dexto.ai/docs/cli/#install-script)
(installs under `~/.dexto`, no admin).

`dexto login --device` prints a link and code on stderr, then waits for approval. Run it so you
can read its output while it waits, and pass both to the person.
Do not approve sign-in on their behalf. Check the first account result:

```sh
dexto whoami --json
```

Success is exit 0 with your account identity. Signed-out account commands exit 3 with
`needs_sign_in`; for a headless machine, run `dexto login --device` and retry. Installation and
`dexto --version` need no sign-in. Account and workspace requests do; model runs also need a
configured model or credits. This check starts no model run.

## What You Can Do

- Talk to any LLM in your terminal
- Run long-lived AI agents with tools, knowledge, and memories
- Run one task headless with `dexto run`
- Build in Dexto Cloud and use your workspace from the terminal

---

## Main Command

### Basic Usage

```bash
# Start the interactive CLI
dexto

# Start the interactive CLI and run a prompt
dexto -p "create a snake game"

# Run a single headless task
dexto run "list files here"
```

The first start needs a model: a provider key in the environment (such as `ANTHROPIC_API_KEY`) or `dexto login` for Dexto models. With neither, `dexto` points you to `dexto login`.

### Main Command Options

| Flag | Description | Example |
|------|-------------|---------|
| `-v, --version` | Show version | `dexto --version` |
| `-a, --agent <id\|path>` | Use agent ID or path to config file | `dexto -a nano-banana-agent` |
| `-p, --prompt <text>` | Start the interactive CLI and run the prompt | `dexto -p "list files"` |
| `-m, --model <model>` | Specify LLM model | `dexto -m gpt-5-mini` |
| `-c, --continue` | Continue most recent conversation | `dexto -c` |
| `-r, --resume <sessionId>` | Resume a specific session by ID | `dexto --resume my-session` |
| `-s, --strict` | Require all MCP servers to connect | `dexto --strict` |
| `--no-verbose` | Disable verbose output | `dexto --no-verbose` |
| `--no-interactive` | Disable interactive prompts | `dexto --no-interactive` |
| `--permissions-mode` | Select `manual` or `auto-approve` in TUI or headless mode | `dexto --permissions-mode manual` |
| `--auto-approve` / `--bypass-permissions` | Select `auto-approve`; mandatory approvals still apply | `dexto --auto-approve` |

**Note:** The `-a, --agent` flag accepts bundled agent IDs and paths to agent config files. See the [Agent Registry](/docs/guides/agent-registry) for available agents.

## Subcommands

### `run` - Run a Headless Task

Use `dexto run "your task"` for a non-interactive task. It prints the reply at a terminal and one JSON result otherwise; `--json`, `--stream-json` and `--text` choose explicitly. See [Headless Tasks](./headless-tasks.md) for the output contract.

### `login` - Sign In to Dexto

Signing in is optional: signed out, Dexto runs fully locally with your own model keys.

```bash
dexto login                 # sign in with your browser
dexto login --device        # approve a code on any device (SSH, no browser)
dexto login --org acme      # sign in for an organization, saved as profile "acme"
echo "$KEY" | dexto login --api-key -  # save a Dexto API key, for CI
dexto login --api-key       # paste a key when asked, kept out of shell history
dexto whoami                # who commands act as
dexto accounts list         # saved sign-ins; * marks the one in use
dexto accounts use acme     # switch
dexto accounts remove acme  # log out and forget (asks first, or --yes)
dexto logout                # end the sign-in on the server and forget it here
```

Sign-ins are saved per profile in `~/.dexto/accounts/`, readable only by you. `--profile <name>` or `DEXTO_PROFILE` picks one for a single run, and `DEXTO_API_KEY` takes precedence over any saved sign-in. A first sign-in only reads; `--scope <permission>` asks for more and keeps what was granted before. Sign-ins from the `dexto-cloud` preview CLI are carried over once.

Signed in, every local session also gets the Dexto MCP as a server named `dexto`: your connectors, Drive, Sites and Apps, Loops and memory, beside your own MCP servers. Its tools ask first through the normal approval prompt. If Dexto is unreachable, the session still runs and those tools show as unavailable. A server you name `dexto` yourself takes its place.

### `upgrade` - Upgrade Dexto CLI

For script installs, upgrade the Dexto CLI with `dexto upgrade`. For npm installs, use `npm install -g dexto`.

```bash
dexto upgrade
```

**Options:**
- `--dry-run` - Print install/migration commands without executing
- `--force` - Force reinstall for native install target

### `uninstall` - Uninstall Dexto CLI

Uninstall the Dexto CLI binary:

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

### Removed in 2.0

These 1.x local-agent commands are gone in 2.0:

| 1.x | Use instead |
| --- | --- |
| `dexto setup`, `dexto connect` (1.x provider setup) | `dexto login`, or a provider key in an env var |
| `dexto agents install\|list` | `dexto -a ./agent.yml`; hosted agents with `dexto cloud agents` |
| `dexto init skill` | `dexto skills push` / `dexto skills sync` |
| `dexto mcp call\|tools` | `dexto workspace call` / `dexto workspace tools` |
| `dexto search` | `dexto chat history` |
| `dexto --mode web` | the Dexto dashboard |
| `--mode server\|mcp`, `create-app`, `init-app`, `image`, `plugin`, `which` | no CLI replacement; build apps with the `@dexto/core` SDK |
| `dexto --agent triage-agent` (bundled demo) | removed: it ran its sub-agents with `--mode mcp` |

The rest of `agents`, `init` and `mcp`, plus `create-image`, `--image`, `--no-auto-install`, `--skip-setup`, `--dev` and `--port`, are removed without a replacement. 2.0's `dexto connect claude` and `dexto connect codex` are different, new commands: they sign Claude Code or Codex in on Dexto Cloud.

To upgrade from 1.x, run `npm install -g dexto`, or `dexto upgrade` for a script install.

---

## Common Usage Patterns

### Quick Start

```bash
# Interactive session with default settings
dexto

# Use a specific agent
dexto --agent nano-banana-agent

# Start with a specific model
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
# Continue most recent conversation
dexto --continue

# Continue with a one-shot prompt, then exit
dexto -c -p "now add error handling"

# Resume specific session (get the id from dexto chat list)
dexto --resume my-project-session

# Resume and run a one-shot prompt
dexto -r my-project-session "fix the bug we discussed"
```

### Custom Agents

```bash
# Use a custom agent file
dexto --agent ./my-agent.yml
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

### History

```bash
# List this machine's chats
dexto chat list

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

Every cloud command takes `--json` or `--table`, `--api-key <key>`, `--profile <name>` and `--project <id>`. Output is JSON when stdout isn't a terminal, and a failure prints `{"error":{"code","message","fix"}}` on stderr, where `fix` is the command that fixes it. Exit codes: 0 done, 1 failed, 2 usage, 3 needs sign-in or permission, 4 needs `--yes` (pass it only once your person has agreed), 5 not found, 6 waiting on a person (such as an agent run paused at an approval). `dexto login`, `logout`, `whoami`, `accounts`, `models list` and `billing` follow the same contract. A command that needs a permission your sign-in lacks offers, at a terminal, to sign in again for it.

Signed in as a person, each session starts by syncing your Dexto Skills library to `~/.dexto/cloud-skills/`, where Skill discovery finds them after your own Skills, so a local Skill of the same name wins. Signed out, or with an API key, that copy is removed. `dexto skills sync` syncs on demand, and `dexto skills push <dir>` adds a local Skill to your library.

Deploy Sites and Functions with `dexto cloud sites deploy` and `dexto cloud functions deploy`, each packed with the project's own packer. Dexto 1.x's `dexto deploy` (workspace deploys) is gone in 2.0, along with `dexto --cloud-agent`.

### Run traces

`dexto trace` and `dexto span` read your runs' traces from Dexto's public `/v1/traces` API. Spans are kept 30 days.

```bash
dexto trace list --period 3h --status failed     # your recent run traces, newest first
dexto trace view <run_id>                        # one run's spans in start order, with errors
dexto span list <run_id> --name llm.stream --sort duration --limit 5
```

`trace list` takes `--period` (such as `15m`, `3h` or `7d`, at most `30d`), `--status`, `--session` and `--limit` (at most 100). `span list` takes `--name`, `--status` (`completed` or `failed`), `--sort` (`started_at` or `duration`) and `--limit` (at most 500). They print tables at a terminal and JSON with `--json` or when piped. Reading traces needs `runs:read`. If your sign-in lacks it, the CLI offers to sign in again for it, or prints `dexto login --scope runs:read`. An API key needs the `runs:read` permission: create one that has it.

## Your Dexto Workspace

Signed in, `dexto workspace` uses your workspace as you, over the Dexto MCP: the same apps and tools your agents use.

```bash
dexto workspace                            # your apps
dexto workspace drive                      # what an app does
dexto workspace drive put ./report.pdf     # upload into Drive
dexto workspace artifacts create ./plan.html --title Plan --idempotency-key plan-1 --yes
dexto workspace artifacts list --chat <id> --json
dexto workspace artifacts get <id> --out ./plan.html
dexto workspace artifacts share <id> --visibility link-shared --yes
dexto workspace email send --to a@b.c --yes
dexto workspace tools --search calendar    # every tool, by MCP name
dexto workspace call dexto_search --data '{"query":"invoices"}'
dexto find "share a file"                  # the command for what you want to do
```

An operation that acts, approves or spends asks first; pass `--yes` only once your person has agreed (without it, and with no one to ask, the command exits 4 with the command that goes ahead). Workspace tools act as a person, so an API key can't use them. An operation your sign-in can't use yet names the `dexto login --scope` that grants it.

`dexto workspace artifacts` saves HTML files as Artifacts in your library (`list`, `get`, `create`, `replace`, `share`). HTML comes from a file or `-` for stdin, never an argument; `get --out` writes it back to a file. `create --idempotency-key` makes a retry return the first Artifact instead of a copy, `replace` keeps the title, kind, summary, surface and renderer you don't change, and every write takes `--dry-run`.

## Next Steps

- **[Interactive Commands](./interactive-commands)** - Slash commands for chat sessions
- **[Agent Registry](/docs/guides/agent-registry)** - Browse available agents
- **[Agent Configuration](/docs/guides/configuring-dexto/overview)** - Create custom agents
- **[MCP Integration](/docs/mcp/overview)** - Connect external tools and services
