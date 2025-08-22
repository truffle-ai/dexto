# Interactive CLI Commands

This directory contains the modular CLI command system for Dexto. The architecture has been designed to be maintainable, extensible, and well-organized.

## Architecture Overview

The CLI system is built with a modular approach where commands are organized by functionality and category. This makes it easy to add new commands, modify existing ones, and maintain the codebase.

### Core Components

#### `commands.ts` - Main Aggregator
- **Purpose**: Combines all modular commands into a single `CLI_COMMANDS` array
- **Exports**: `CLI_COMMANDS`, `executeCommand()`, `getAllCommands()`
- **Pattern**: Uses both direct imports and spread operators for different command types

#### `command-parser.ts` - Core Infrastructure
- **Purpose**: Provides parsing, formatting, and help display utilities
- **Key Functions**:
  - `parseInput()` - Distinguishes between commands and prompts
  - `displayAllCommands()` - Shows categorized help display
  - `formatCommandHelp()` - Formats individual command help
  - `getCommandSuggestions()` - Command completion support

### Command Organization

Commands are organized into logical modules based on functionality:

#### Simple Commands (Array Exports)
These export arrays of individual `CommandDefinition` objects:

- **`general-commands.ts`** - Basic CLI functionality
  - `/help` - Command help system (special factory pattern)
  - `/exit` - CLI termination  
  - `/clear` - Reset conversation

- **`system/system-commands.ts`** - System configuration
  - `/log` - Log level management
  - `/config` - Configuration display
  - `/stats` - System statistics

- **`tool-commands.ts`** - Tool management
  - `/tools` - List available MCP tools

- **`prompt-commands.ts`** - System prompt
  - `/prompt` - Display current system prompt

- **`documentation-commands.ts`** - Help resources
  - `/docs` - Open documentation in browser

- **`session/`** - Session management (folder)
  - `/session` - Session management (parent command with subcommands)
  - `/history` - Standalone history command
  - `/search` - Standalone search command

#### Hierarchical Commands (Single Object Exports)
These export single `CommandDefinition` objects with subcommands:

- **`model/model-commands.ts`** - Model management
  - `/model list` - List available models
  - `/model current` - Show current model
  - `/model switch` - Switch models
  - `/model help` - Model help

- **`mcp/mcp-commands.ts`** - MCP server management
  - `/mcp list` - List MCP servers
  - `/mcp add` - Add MCP servers (with sub-subcommands for stdio/http/sse)
  - `/mcp remove` - Remove MCP servers
  - `/mcp help` - MCP help

### File Structure

```
src/app/cli/interactive-commands/
├── README.md                          # This file
├── commands.ts                        # Main command aggregator
├── command-parser.ts                  # Core parsing and formatting utilities
├── general-commands.ts                # Basic CLI commands
├── tool-commands.ts                   # Tool management
├── prompt-commands.ts                 # System prompt display
├── documentation-commands.ts          # Documentation access
├── session/                           # Session management
│   ├── index.ts                      # Session module exports
│   ├── session-commands.ts           # Session command implementations
│   └── helpers/
│       └── formatters.ts             # Session formatting utilities
├── model/                            # Model management
│   ├── index.ts                      # Model module exports
│   └── model-commands.ts             # Model command implementations
├── mcp/                              # MCP server management
│   ├── index.ts                      # MCP module exports
│   ├── mcp-commands.ts               # MCP command implementations
│   └── mcp-add-utils.ts              # MCP add command utilities
└── system/                           # System commands
    ├── index.ts                      # System module exports
    └── system-commands.ts            # System command implementations
```

## Command Categories

The help system displays commands in these categories:

1. **General** - Basic CLI functionality
2. **Session Management** - Session, history, and search
3. **Model Management** - AI model configuration
4. **MCP Management** - MCP server management
5. **Tool Management** - Available tools
6. **Prompt Management** - System prompt
7. **System** - Configuration and statistics
8. **Documentation** - Help resources

## Design Patterns

### Help Command Factory Pattern
The `/help` command uses a factory pattern to access all commands:
```typescript
export function createHelpCommand(getAllCommands: () => CommandDefinition[]): CommandDefinition
```

### Consistent Export Patterns
- **Arrays**: `export const commandName: CommandDefinition[] = [...]`
- **Single Objects**: `export const commandName: CommandDefinition = {...}`

### Module Index Pattern
Each folder has an `index.ts` that re-exports the main command definitions for clean imports.

### Command Handler Pattern
All command handlers follow the same signature:
```typescript
handler: async (args: string[], agent: DextoAgent) => Promise<boolean>
```

## Adding New Commands

### Simple Command (Individual)
1. Add to appropriate `*-commands.ts` file or create new file
2. Export as array: `export const newCommands: CommandDefinition[] = [...]`
3. Import and spread in `commands.ts`: `...newCommands`

### Hierarchical Command (With Subcommands)
1. Create new folder with `index.ts` and `*-commands.ts`
2. Export as single object: `export const newCommand: CommandDefinition = {...}`
3. Import directly in `commands.ts`: `newCommand`

### Folder Structure Command
1. Create folder: `mkdir new-category/`
2. Add `index.ts`, `*-commands.ts`, and any utilities
3. Update `commands.ts` imports and exports
4. Update category order in `command-parser.ts`

## Best Practices

### Code Organization
- Keep related commands in the same module
- Use helper files for complex utilities
- Follow consistent naming conventions

### Type Safety
- Always use proper TypeScript types
- Import types from `@core/index.js`
- Use `CommandDefinition` interface consistently

### Error Handling
- Always wrap async operations in try/catch
- Use `logger.error()` for error reporting
- Return `true` to continue CLI, `false` to exit

### Help Documentation
- Provide clear descriptions and usage examples
- Use real examples from `agents/` directory
- Include tips and best practices in help text

### Import Standards
- All imports must end with `.js` for ES module compatibility
- Use relative imports within the same module
- Import types separately when possible

## Dependencies

The CLI system depends on:
- `@core/index.js` - Core Dexto agent functionality
- `chalk` - Terminal color formatting
- Various MCP and session management utilities

## Testing

Commands should be tested by:
1. Unit tests for individual command logic
2. Integration tests for agent interactions
3. Manual testing of CLI user experience

The modular architecture makes it easy to test individual command modules in isolation.