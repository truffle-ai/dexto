# Dexto CLI Documentation

The Dexto CLI provides an interactive terminal interface for conversing with AI agents, managing sessions, switching models, and executing commands.

## Quick Start

```bash
# Start the interactive CLI
dexto

# Run one headless task
dexto run "what is the current time"

# Run with a specific agent
dexto --agent ./my-agent.yml
```

The first start needs a model: a provider key in the environment (such as `ANTHROPIC_API_KEY`) or `dexto login` for Dexto models. With neither, `dexto` points you to `dexto login`. An explicit agent file or a project-local agent config starts without this check.

## Sign-in and credits

`dexto login` asks once for reading, Project changes and chat work, which can spend credits.
Direct computer writes and Loops need a separate step-up. Use `--scope SCOPE` for additional permissions;
the approval page shows the requested access. Interactive step-ups list the full requested scope set;
headless or `--json` commands exit 3 with the missing scope and login command.

New users signing up with Google or GitHub receive a one-time $5 usage credit per verified email.

## Removed in 2.0

`dexto` 2.0 is the cloud and infrastructure CLI around the local agent harness. These 1.x local-agent commands are gone:

| 1.x | Use instead |
| --- | --- |
| `dexto setup`, `dexto connect` | `dexto login`, or a provider key in an env var |
| `dexto agents install\|list` | `dexto -a ./agent.yml`; hosted agents with `dexto cloud agents` |
| `dexto init skill` | `dexto skills push` / `dexto skills sync` |
| `dexto mcp call\|tools` | `dexto workspace call` / `dexto workspace tools` |
| `dexto search` | `dexto chat history` |
| `dexto --mode web` | the Dexto dashboard |
| `--mode server\|mcp`, `create-app`, `init-app`, `image`, `plugin`, `which` | no CLI replacement; build apps with the `@dexto/core` SDK |
| `dexto --agent triage-agent` (bundled demo) | removed: it ran its sub-agents with `--mode mcp` |

The rest of `agents`, `init` and `mcp`, plus `create-image`, `--image`, `--no-auto-install`, `--skip-setup`, `--dev` and `--port`, are removed without a replacement.

## CLI Features

### Interactive Chat
- **Modern Terminal UI** - Built with Ink for a responsive, chat-optimized interface
- **Real-time Streaming** - See AI responses as they're generated
- **Message History** - Scroll through conversation with up/down arrows
- **Auto-complete** - Slash commands and resource mentions with tab completion

### Slash Commands
Type `/` to see available commands:

- `/help` - Show available commands
- `/model` - Switch LLM model (interactive selector)
- `/session` - Manage chat sessions
  - `/session list` - List all sessions
  - `/session switch` - Switch to another session (interactive)
  - `/session new` - Create new session
  - `/session delete <id>` - Delete a session
- `/clear` - Clear conversation history
- `/exit` or `/quit` - Exit the CLI

### Resource References
Use `@` to reference files and resources:
- Type `@` at the start of input or after a space
- Autocomplete shows available resources from MCP servers
- Select with arrow keys and Enter

### Session Management
- **New session**: Each CLI launch starts fresh (first message creates new session)
- **Resume by ID**: `dexto -r <session-id>` (resume specific session)
- **Resume interactively**: Use `/resume` or `/session switch` in CLI
- **Auto-save**: Sessions are automatically saved
- **Read a chat**: `dexto chat history <session-id>`

### Model Switching
```bash
# Switch model via command
dexto -m gpt-4o

# Or use interactive selector in CLI
/model
```

### Keyboard Shortcuts
- **↑/↓** - Navigate input history
- **Esc** - Cancel current operation or close overlays
- **Ctrl+C** - Exit CLI (or cancel if processing)
- **Tab** - Autocomplete commands/resources
- **Enter** - Submit input or select autocomplete item

## Advanced Usage

### Tool Confirmation
```bash
# Auto-approve all tool executions
dexto --auto-approve

# Manual approval (default)
dexto
```

### Custom Agents
```bash
# Use a bundled agent by name
dexto --agent coding-agent

# Use agent from file
dexto --agent ./my-agent.yml
```

### Headless Mode
```bash
# One-shot query with output
dexto -p "list files in current directory"

# Resume a session and run query
dexto -r <session-id> -p "what did we discuss?"

# Piped input
cat document.txt | dexto -p "summarize this"
```

## Architecture

The CLI is built on a modern, maintainable architecture:

### Core Components
- **InkCLIRefactored** - Main orchestrator using React Ink
- **State Management** - Centralized reducer pattern for predictable state
- **Custom Hooks** - Reusable logic (events, history, shortcuts, overlays)
- **Services** - Business logic layer (commands, messages, input parsing)
- **Base Components** - Reusable UI primitives (selectors, autocomplete)

### Code Structure
```text
packages/cli/src/cli/ink-cli/
├── InkCLIRefactored.tsx       # Main component
├── state/                      # State management
├── hooks/                      # Custom hooks
├── services/                   # Business logic
├── components/                 # UI components
│   ├── base/                   # Reusable components
│   ├── chat/                   # Chat UI
│   ├── input/                  # Input area
│   └── overlays/               # Model/session selectors
├── containers/                 # Smart containers
└── utils/                      # Helper functions
```

## Troubleshooting

### CLI Not Starting
- Ensure terminal supports UTF-8 and ANSI colors
- Try setting `TERM=xterm-256color`
- Check that Node.js >= 20.0.0

### Autocomplete Not Working
- Make sure you're in interactive mode (not headless)
- Type `/` for commands or `@` for resources
- Arrow keys to navigate, Tab to load into input, Enter to select

### Session Not Found
- List sessions: `dexto chat list`
- Sessions are stored in `~/.dexto/sessions/` (or repo `.dexto/` in dev mode)
- Use session ID from list output

### Model Not Available
- Check configured providers in agent config
- Ensure API keys are set in environment or `.env`
- Use `/model` to see available models

## Development

### Dev Mode
```bash
# Use repository configs (not global ~/.dexto)
export DEXTO_DEV_MODE=true
dexto
```

### Hot Reload
```bash
pnpm run build:cli
dexto
```

### Testing
```bash
# Unit tests
pnpm run test:unit

# Integration tests
pnpm run test:integ

# All tests
pnpm test
```

## See Also

- [Main README](../../README.md) - Project overview
- [Development Guide](../../DEVELOPMENT.md) - Development workflows
- [Agent Configuration](../../agents/coding-agent/coding-agent.yml) - Default agent setup
- [Core Documentation](../core/README.md) - Core library reference
