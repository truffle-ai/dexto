# Project Commands

This directory contains CLI commands for **project scaffolding and initialization**. These are standalone Commander.js commands that help users create and set up new Dexto projects.

## Commands

### `dexto create-app`
- **Purpose**: Scaffold a new Dexto TypeScript application from scratch
- **Implementation**: `create.ts`
- **Features**:
  - Creates project directory and basic structure
  - Sets up package.json with Dexto dependencies
  - Creates tsconfig.json configuration
  - Initializes git repository
  - Interactive setup for LLM provider and API keys

### `dexto init-app`
- **Purpose**: Initialize an existing TypeScript project with Dexto
- **Implementation**: `init.ts`
- **Features**:
  - Validates existing package.json and tsconfig.json
  - Adds Dexto configuration to existing project
  - Sets up agent configuration files
  - Interactive LLM provider setup

## Architecture

These commands follow a **run-once-and-exit** pattern:
- Execute scaffolding operations
- Set up initial project structure
- Exit with success/failure status
- No ongoing runtime or server functionality

## File Structure

```
project-commands/
├── README.md          # This file
├── index.ts           # Exported functions for main CLI
├── create.ts          # `dexto create-app` implementation
├── init.ts            # `dexto init-app` implementation  
└── init.test.ts       # Tests for init functionality
```

## Integration

Project commands are registered in the main CLI file (`src/app/index.ts`) using Commander.js:

```typescript
program
    .command('create-app')
    .description('Scaffold a new Dexto Typescript app')
    .action(async () => {
        // Implementation imports from this directory
    });
```

## Related Directories

- **`interactive-commands/`**: Slash commands used within the interactive CLI (`/help`, `/session`)
- **`global-commands/`**: System-wide configuration commands (`dexto setup`, `dexto install`)
- **`utils/`**: Shared utilities across all CLI commands