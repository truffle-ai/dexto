# Dexto CLI Documentation

The Dexto CLI provides an interactive terminal interface for conversing with AI agents, managing sessions, switching models, and executing commands.

## Quick Start

```bash
# Start web UI (default)
dexto

# Start interactive CLI
dexto --mode cli

# Run one-shot query
dexto "what is the current time"

# Run with specific agent
dexto --agent coding-agent --mode cli
```

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
- **Resume by ID**: `dexto --mode cli -r <session-id>` (resume specific session)
- **Resume interactively**: Use `/resume` or `/session switch` in CLI
- **Auto-save**: Sessions are automatically saved
- **Search history**: `dexto search <query>`

### Model Switching
```bash
# Switch model via command
dexto -m gpt-4o --mode cli

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
dexto --mode cli --auto-approve

# Manual approval (default)
dexto --mode cli
```

### Custom Agents
```bash
# Use agent by name
dexto --agent coding-agent --mode cli

# Use agent from file
dexto --agent ./my-agent.yml --mode cli
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
- List sessions: `dexto session list`
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
dexto --mode cli
```

### Hot Reload
```bash
# Build and run dev server
bun run dev

# Or just CLI
bun run build:cli
dexto --mode cli
```

### Testing
```bash
# Unit tests
bun run test:unit

# Integration tests
bun run test:integ

# All tests
bun run test
```

## See Also

- [Main README](../../README.md) - Project overview
- [Development Guide](../../DEVELOPMENT.md) - Development workflows
- [Agent Configuration](../../agents/coding-agent/coding-agent.yml) - Default agent setup
- [Core Documentation](../core/README.md) - Core library reference
