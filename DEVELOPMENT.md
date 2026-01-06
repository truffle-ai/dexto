# Development Guide

This guide covers development workflows for working on the Dexto codebase.

## Table of Contents
- [Project Structure](#project-structure)
- [Development Setup](#development-setup)
- [Development Workflows](#development-workflows)
- [Build Commands](#build-commands)
- [Testing](#testing)
- [Code Quality](#code-quality)
- [Publishing](#publishing)

## Project Structure

Dexto is a monorepo using pnpm workspaces with the following structure:

```
dexto/
├── packages/
│   ├── core/          # @dexto/core - Core business logic
│   ├── cli/           # dexto - CLI application
│   └── webui/         # @dexto/webui - Next.js web interface
├── scripts/           # Build and development scripts
├── agents/            # Agent configurations
└── docs/              # Documentation
```

### Package Dependencies
- `dexto` (CLI) depends on `@dexto/core`
- `@dexto/webui` is embedded into CLI at build time
- All packages version together (fixed versioning)

## Development Setup

### Prerequisites
- Node.js >= 20.0.0
- pnpm (automatically managed via Corepack)

### Initial Setup
```bash
# Clone the repository
git clone https://github.com/truffle-ai/dexto.git
cd dexto

# Enable Corepack (if not already enabled) - this picks pnpm version
corepack enable

# Install dependencies (Corepack will use the correct pnpm version)
pnpm install

# Build all packages
pnpm run build
```

## Development Workflows

### 1. Hot Reload Development (Recommended)
Best for frontend development with automatic reload:

```bash
pnpm run dev
```

This command:
- Builds core and CLI packages
- Runs API server on port 3001 (from built dist)
- Runs WebUI dev server on port 3000 (with hot reload)
- Prefixes output with `[API]` and `[UI]` for clarity
- **Automatically sets `DEXTO_DEV_MODE=true`** to use repository agent configs

Access:
- API: http://localhost:3001
- WebUI: http://localhost:3000

### 2. Symlink Development
Best for CLI development with instant changes:

```bash
# Create global symlink (full build with WebUI)
pnpm run link-cli

# Create global symlink (fast, no WebUI)
pnpm run link-cli-fast

# Remove symlink
pnpm run unlink-cli
```

Now `dexto` command uses your local development code directly.

### 3. Production-like Testing
Test the actual installation experience:

```bash
# Install globally from local build (full)
pnpm run install-cli

# Install globally from local build (fast, no WebUI)
pnpm run install-cli-fast
```

This creates tarballs and installs them globally, simulating `npm install -g dexto`.

### Switching Between Workflows

The `link-cli` and `install-cli` commands are mutually exclusive:
- Running `link-cli` removes any npm installation
- Running `install-cli` removes any pnpm symlink
- Use `unlink-cli` to remove everything

## Build Commands

### Complete Builds
```bash
# Full build with cleaning
pnpm run build

# Build all packages without cleaning
pnpm run build:all

# Build with type checking
pnpm run build:check
```

### Package-Specific Builds
```bash
# Build individual packages
pnpm run build:core
pnpm run build:cli
pnpm run build:webui

# Build CLI and its dependencies only (no WebUI)
pnpm run build:cli-only
```

### WebUI Embedding
The WebUI is embedded into the CLI's dist folder during build:

```bash
# Embed WebUI into CLI dist (run after building WebUI)
pnpm run embed-webui
```

## Testing

### Automated Tests
```bash
# Run all tests
pnpm test

# Run unit tests only
pnpm run test:unit

# Run integration tests only
pnpm run test:integ

# Run tests with coverage
pnpm run test:ci
```

### Manual testing

1. Common commands
```bash
cd ~
dexto --help 
dexto "what is the current time"
dexto "list files in current directory"

# Test other model override in CLI
dexto -m gpt-5-mini "what is the current date"

# Test web mode
dexto

# Test discord bot mode (requires additional setup)
dexto --mode discord

# Test telegram bot mode (requires additional setup)
dexto --mode telegram
```

2. Execution contexts

Dexto CLI operates differently based on the directory you are running in.
- source context -> when Dexto CLI is run in the source repository
- global context -> when Dexto CLI is run outside the source repository
- project context -> when Dexto CLI is run in a project that consumes @dexto dependencies

Based on execution context, Dexto CLI will use defaults for log path, default agent/agent registry.
Run the CLI in different places and see the console logs to understand this.

Test above commands in different execution contexts for manual testing coverage.

**Developer Mode Environment Variable:**

When running `dexto` from within this repository, it normally uses your `dexto setup` preferences and global `~/.dexto` directory. To force isolated testing with repository files:
```bash
export DEXTO_DEV_MODE=true  # Use repo configs and local .dexto directory
```

**DEXTO_DEV_MODE Behavior:**
- **Agent Config**: Uses `agents/coding-agent/coding-agent.yml` from repo (instead of `~/.dexto/agents/`)
- **Logs/Database**: Uses `repo/.dexto/` (instead of `~/.dexto/`)
- **Preferences**: Skips global setup validation
- **Use Case**: Isolated testing and development on Dexto itself

**Note**: `pnpm run dev` automatically sets `DEXTO_DEV_MODE=true`, so the development server always uses repository configs and local storage.

## Code Quality

### Type Checking
```bash
# Type check all packages
pnpm run typecheck

# Type check with file watching
pnpm run typecheck:watch

# Type check specific package
pnpm run typecheck:core
```

### Linting
```bash
# Run linter
pnpm run lint

# Fix linting issues
pnpm run lint:fix
```

### Pre-commit Checks
Before committing, always run:
```bash
pnpm run build:check  # Typecheck + build
pnpm test            # Run tests
pnpm run lint        # Check linting
```

## Publishing

### Changeset Workflow

We use [Changesets](https://github.com/changesets/changesets) for version management:

1. **Create a changeset** for your changes:
   ```bash
   pnpm changeset
   ```

2. **Select packages** affected by your change

3. **Choose version bump** (patch/minor/major)

4. **Write summary** of your changes

### Version Strategy

- **Fixed versioning**: All packages version together
- `@dexto/core` and `dexto` always have the same version
- `@dexto/webui` is private and not published

### Publishing Process

Publishing is automated via GitHub Actions:
1. Merge PR with changeset
2. Bot creates "Version Packages" PR
3. Merge version PR to trigger npm publish

## Common Tasks

### Clean Everything
```bash
# Clean all build artifacts and caches
pnpm run clean

# Clean storage only
pnpm run clean:storage
```

### Start Production Server
```bash
# Start the CLI (requires build first)
pnpm start
```

### Working with Turbo

Turbo commands run tasks across all packages:
```bash
pnpm run repo:build      # Build all packages with Turbo
pnpm run repo:test       # Test all packages with Turbo
pnpm run repo:lint       # Lint all packages with Turbo
pnpm run repo:typecheck  # Typecheck all packages with Turbo
```

## Troubleshooting

### Native Dependencies
If you see errors about missing bindings (e.g., better-sqlite3):
```bash
# Reinstall dependencies
pnpm install

# If that doesn't work, clean and reinstall
pnpm run clean
pnpm install
```

### Port Conflicts
Default ports:
- API/Server: 3001
- WebUI Dev: 3000

Set environment variables to use different ports:
```bash
PORT=4000 API_PORT=4001 pnpm run dev
```

### Global Command Not Found
If `dexto` command is not found after linking:
```bash
# Check global installations
pnpm list -g
npm list -g dexto --depth=0

# Verify PATH includes pnpm/npm global bin
echo $PATH
```

## Questions?

- Check [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines
- Open an issue for bugs or feature requests
- Join our Discord for development discussions