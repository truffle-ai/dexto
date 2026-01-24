---
sidebar_position: 3
title: "Interactive Commands"
---

# Interactive Commands

When running `dexto` or `dexto --mode cli`, these slash commands are available in the interactive session.

## General

| Command | Aliases | Description |
|---------|---------|-------------|
| `/help` | `/h`, `/?` | Show all commands |
| `/exit` | `/quit`, `/q` | Exit the CLI |
| `/new` | | Start new conversation |
| `/clear` | `/reset` | Clear context (keeps session) |
| `/compact` | `/summarize` | Compress older messages |
| `/context` | `/ctx`, `/tokens` | Show token usage |
| `/copy` | `/cp` | Copy last response |
| `/shortcuts` | `/keys` | Show keyboard shortcuts |
| `!<cmd>` | `/shell` | Run shell command |

## Sessions

| Command | Description |
|---------|-------------|
| `/resume` | Browse and resume sessions |
| `/rename` | Rename current session |
| `/search <query>` | Search across sessions |
| `/session list` | List all sessions |
| `/session history` | Show current session history |
| `/session delete <id>` | Delete a session |

## Configuration

| Command | Description |
|---------|-------------|
| `/model` | Change LLM model |
| `/model list` | List available models |
| `/model current` | Show current model |
| `/config` | Show configuration |
| `/config reload` | Reload config from file |
| `/sysprompt` | Show system prompt |
| `/log [level]` | Set log level (debug/info/warn/error) |
| `/stats` | Show statistics |

## MCP & Tools

| Command | Description |
|---------|-------------|
| `/mcp` | List MCP servers |
| `/mcp list` | List connected servers |
| `/mcp add stdio <name> <cmd>` | Add stdio MCP server |
| `/mcp add http <name> <url>` | Add HTTP MCP server |
| `/mcp add sse <name> <url>` | Add SSE MCP server |
| `/mcp remove <name>` | Remove MCP server |
| `/tools` | Browse available tools |
| `/tools list` | List all tools |
| `/tools search <query>` | Search for tools |

## Prompts

| Command | Description |
|---------|-------------|
| `/prompts` | List all prompts |
| `/use <prompt> [args]` | Execute a prompt |
| `/<prompt-name>` | Execute prompt directly |
| `/docs` | Open documentation |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+C` | Clear input / cancel |
| `Escape` | Close overlay |
| `↑` / `↓` | Navigate history |
| `Tab` | Autocomplete |
| `Shift+Enter` | Multi-line input |

## Examples

### Managing Sessions

```bash
# List all sessions
/session list

# Resume a previous session
/resume

# Search for something you discussed
/search "database migration"

# Rename current session
/rename my-project-refactor
```

### Working with Models

```bash
# See current model
/model current

# List available models
/model list

# Switch to a different model
/model switch gpt-5
```

### Using MCP Tools

```bash
# See all available tools
/tools list

# Search for specific tools
/tools search "file"

# List connected MCP servers
/mcp list
```

### Debugging

```bash
# Check token usage
/context

# View system prompt
/sysprompt

# Enable debug logging
/log debug

# Show system stats
/stats
```
