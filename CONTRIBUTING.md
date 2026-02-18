  # Contributing to Dexto

We welcome contributions! This guide will help you get started with contributing to the Dexto project.

## Table of Contents
- [Getting Started](#getting-started)
- [Contributing MCPs and Example Agents](#contributing-mcps-and-example-agents)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Code Standards](#code-standards)
- [Commit Guidelines](#commit-guidelines)
- [Changesets](#changesets)

## Getting Started

Before contributing, please:
1. Read our [Code of Conduct](./CODE_OF_CONDUCT.md)
2. Check existing [issues](https://github.com/truffle-ai/dexto/issues) and [pull requests](https://github.com/truffle-ai/dexto/pulls)
3. Open an issue for discussion on larger changes or enhancements

## Contributing MCPs and Example Agents

We especially encourage contributions that expand Dexto's ecosystem! Here are three ways you can contribute:

### 1. Adding New MCPs to the WebUI Registry

Help other users discover and use new MCP servers by adding them to our built-in registry.

**How to add an MCP to the registry:**

1. Edit `src/app/webui/lib/server-registry-data.json`
2. Add a new entry following this structure:

```json
{
  "id": "unique-server-id",
  "name": "Display Name",
  "description": "Brief description of what this server does",
  "category": "productivity|research|creative|development|data|communication",
  "icon": "📁",
  "config": {
    "type": "stdio|http|sse",
    "command": "npx|uvx|python",
    "args": ["-y", "package-name"],
    "env": {
      "API_KEY": ""
    },
    "timeout": 30000
  },
  "tags": ["tag1", "tag2"],
  "isOfficial": false,
  "isInstalled": false,
  "requirements": {
    "platform": "all|windows|mac|linux",
    "node": ">=20.0.0",
    "python": ">=3.10"
  },
  "author": "Your Name",
  "homepage": "https://github.com/your-repo",
  "matchIds": ["server-id"]
}
```

**Categories:**
- `productivity` - File operations, task management, workflow tools
- `research` - Search, data analysis, information gathering  
- `creative` - Image editing, music creation, content generation
- `development` - Code analysis, debugging, development tools
- `data` - Data processing, analytics, databases
- `communication` - Email, messaging, collaboration tools

**Configuration Types:**
- **Stdio (Node.js)**: `{"type": "stdio", "command": "npx", "args": ["-y", "package-name"]}`
- **Stdio (Python)**: `{"type": "stdio", "command": "uvx", "args": ["package-name"]}`
- **HTTP**: `{"type": "http", "baseUrl": "https://api.example.com/mcp"}`
- **SSE**: `{"type": "sse", "url": "https://api.example.com/mcp-sse"}`

### 2. Creating Example Agents

Showcase how to use MCPs by creating example agents in the `agents/` directory.

**How to create an example agent:**

1. Create a new directory: `agents/your-agent-name/`
2. Add a `your-agent-name.yml` configuration file
3. Include a `README.md` with setup instructions and usage examples
4. Follow the existing agent structure (see `agents/examples/` for reference)

**Example agent structure:**
```
agents/your-agent-name/
├── your-agent-name.yml    # Main configuration
├── README.md             # Setup and usage guide
└── data/                 # Optional: sample data
    └── example.json
```

**Configuration template:**
```yaml
# Your Agent Name
# Brief description of what this agent does

systemPrompt: |
  You are a [Agent Name] specialized in [purpose]. You have access to [MCP servers] that allow you to:
  
  ## Your Capabilities
  - [List key capabilities]
  - [More capabilities]
  
  ## How You Should Behave
  - [Behavior guidelines]
  - [Usage examples]

mcpServers:
  your-mcp:
    type: stdio
    command: npx
    args:
      - -y
      - "package-name"
    env:
      API_KEY: $YOUR_API_KEY

llm:
  provider: openai
  model: gpt-5-mini
  apiKey: $OPENAI_API_KEY

storage:
  cache:
    type: in-memory
  database:
    type: sqlite
    path: .dexto/database/your-agent.db
```

**README template:**
```markdown
# Your Agent Name

Brief description of what this agent does and why it's useful.

## Features
- Feature 1
- Feature 2

## Setup
1. Install dependencies: `npm install`
2. Set environment variables: `export YOUR_API_KEY=your-key`
3. Run the agent: `dexto --agent your-agent-name.yml`

## Usage Examples
- "Example command 1"
- "Example command 2"

## Requirements
- Node.js >= 20.0.0
- Your API key
```

### 3. Adding Agents to the Official Registry

Once you've created a comprehensive example agent, you can add it to the official agent registry so users can discover and install it with `dexto install`.

**How to add an agent to the registry:**

1. Create your agent in `agents/your-agent-name/` (following step 2 above)
2. Edit `agents/agent-registry.json` and add your agent entry
3. Edit `packages/cli/scripts/copy-agents.ts` and add your agent to the `AGENTS_TO_COPY` array
4. Test the build to ensure your agent is properly copied
5. Open a pull request with:
   - Link to your agent directory
   - Description of the agent's purpose and value
   - Screenshots or demos if applicable
   - Evidence of testing and documentation

**Registry Entry Structure (`agents/agent-registry.json`):**

```json
{
  "your-agent-id": {
    "id": "your-agent-id",
    "name": "Your Agent Name",
    "description": "Brief description of what this agent does and its key capabilities",
    "author": "Your Name or Organization",
    "tags": ["category", "use-case", "technology"],
    "source": "your-agent-name/",
    "main": "your-agent-name.yml"
  }
}
```

**Field Guidelines:**

- **id**: Lowercase, hyphenated identifier (e.g., `database-agent`, `podcast-agent`)
- **name**: Human-readable display name (e.g., `Database Agent`, `Podcast Agent`)
- **description**: Clear, concise description of purpose and capabilities (1-2 sentences)
- **author**: Your name, organization, or `Truffle AI` for official agents
- **tags**: 3-6 relevant tags for categorization and search:
  - **Category tags**: `database`, `images`, `video`, `audio`, `coding`, `documents`, etc.
  - **Technology tags**: `gemini`, `openai`, `anthropic`, `mcp`, etc.
  - **Use case tags**: `creation`, `analysis`, `editing`, `generation`, `support`, etc.
- **source**: Directory path relative to `agents/` folder (ends with `/` for directories)
- **main**: Main configuration file name (e.g., `agent.yml`, `your-agent-name.yml`)

**Tag Examples:**
```json
// Content creation agent
"tags": ["images", "generation", "editing", "ai", "gemini"]

// Development agent
"tags": ["coding", "development", "software", "programming"]

// Data analysis agent
"tags": ["database", "sql", "data", "queries", "analysis"]

// Multi-modal agent
"tags": ["audio", "tts", "speech", "multi-speaker", "gemini"]
```

**Complete Example:**
```json
{
  "music-agent": {
    "id": "music-agent",
    "name": "Music Agent",
    "description": "AI agent for music creation and audio processing",
    "author": "Truffle AI",
    "tags": ["music", "audio", "creation", "sound"],
    "source": "music-agent/",
    "main": "music-agent.yml"
  }
}
```

**Single-File vs Directory Agents:**

- **Directory agent** (with multiple files):
  ```json
  {
    "source": "your-agent-name/",
    "main": "agent.yml"
  }
  ```

- **Single-file agent** (all in one YAML):
  ```json
  {
    "source": "your-agent.yml"
  }
  ```
  Note: `main` field is omitted for single-file agents.

**Build Script Configuration (`packages/cli/scripts/copy-agents.ts`):**

Add your agent to the `AGENTS_TO_COPY` array:

```typescript
const AGENTS_TO_COPY = [
    // Core files
    'agent-registry.json',
    'agent-template.yml',

    // Agent directories
    'coding-agent/',
    'database-agent/',
    'your-agent-name/',  // Add your agent here
    // ... other agents
];
```

**Important Notes:**
- Directory agents should end with `/` (e.g., `'your-agent-name/'`)
- Single-file agents should NOT have a trailing slash (e.g., `'your-agent.yml'`)
- The script copies agents to `packages/cli/dist/agents/` during build
- Run `bun run build` to test that your agent is properly copied

**Criteria for registry acceptance:**
- Solves a common, well-defined problem
- Has clear documentation and examples
- Works reliably across different environments
- Provides significant value to the Dexto community
- Follows all coding standards and best practices
- Demonstrates unique capabilities or fills a gap

### Documentation
- Update relevant documentation in `/docs` folder
- Include clear examples in your contributions
- Follow the existing documentation structure

*Tip:* Check out existing examples in `agents/examples/` and `agents/database-agent/` for inspiration! 


## Development Setup

### Prerequisites
- Node.js >= 20.0.0
- Git

### Fork and Clone

1. Fork the repository to your GitHub account

2. Clone your fork:
   ```bash
   git clone https://github.com/your-username/dexto.git
   cd dexto
   ```

3. Add upstream remote:
   ```bash
   git remote add upstream https://github.com/truffle-ai/dexto.git
   ```

### Install Dependencies

```bash
# Install dependencies
bun install

# Build all packages
bun run build
```

### Development Workflow

For detailed development workflows, see [DEVELOPMENT.md](./DEVELOPMENT.md). Quick start:

```bash
# Run development server with hot reload
bun run dev

# Or create a global symlink for CLI development
bun run link-cli
```

## Making Changes

### Create a Feature Branch

```bash
# Update your fork
git checkout main
git pull upstream main

# Create a new branch
git checkout -b feature/your-branch-name
```


### Monorepo Structure

Dexto is a monorepo with three main packages:
- `packages/core` - Core business logic (@dexto/core)
- `packages/cli` - CLI application (dexto)
- `packages/webui` - Web interface (@dexto/webui)

Make changes in the appropriate package(s).

### Code Quality Checks

Before committing, ensure your code passes all checks:

```bash
# Type checking
bun run typecheck

# Run tests
bun run test

# Fix linting issues
bun run lint:fix

# Format code
bun run format

# Full validation (recommended before commits)
bun run build:check
```

## Submitting a Pull Request

### 1. Create a Changeset

For any changes that affect functionality:

```bash
bun x changeset
```

Follow the prompts to:
- Select affected packages
- Choose version bump type (patch/minor/major)
- Describe your changes

This creates a file in `.changeset/` that must be committed with your PR.

### 2. Commit Your Changes

```bash
# Stage your changes
git add .

# Commit with a descriptive message
git commit -m "feat(core): add new validation helper"
```

## Commit Guidelines

#### Commit Message Format

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): subject

body (optional)

footer (optional)
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, semicolons, etc.)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Test additions or fixes
- `chore`: Build process or auxiliary tool changes

Examples:
```bash
feat(cli): add new agent command
fix(core): resolve memory leak in storage manager
docs: update installation instructions
```

### 3. Push and Create PR

```bash
# Push your branch
git push origin feature/your-branch-name
```

Then create a Pull Request on GitHub with:
- Clear title following commit message format
- Description of changes and motivation
- Link to related issue (if applicable)
- Screenshots (for UI changes)

### PR Requirements

Your PR must:
- ✅ Include a changeset (for functional changes)
- ✅ Pass all CI checks
- ✅ Have no merge conflicts
- ✅ Follow code standards
- ✅ Include tests for new functionality

## Code Standards

### TypeScript
- Use strict TypeScript settings
- Avoid `any` types
- Handle null/undefined cases explicitly
- Add JSDoc comments for public APIs

### Error Handling
- Use typed error classes from `packages/core/src/errors/`
- Never use plain `Error` or `throw new Error()`
- Include error context and helpful messages

### Testing
- Unit tests: `*.test.ts`
- Integration tests: `*.integration.test.ts`
- Aim for high coverage of business logic
- Test error cases and edge conditions

### Documentation
- Update relevant documentation with your changes
- Add inline comments for complex logic
- Update README if adding new features

## Changesets

We use [Changesets](https://github.com/changesets/changesets) to manage versions and changelogs.

### When to Add a Changeset

Add a changeset when you:
- Add a new feature
- Fix a bug
- Make breaking changes
- Change public APIs

### When NOT to Add a Changeset

Don't add a changeset for:
- Documentation updates (unless API docs)
- Internal refactoring with no external impact
- Test additions
- Development tooling changes

### Version Bumps

- **Patch** (0.0.X): Bug fixes, minor improvements
- **Minor** (0.X.0): New features, backward compatible
- **Major** (X.0.0): Breaking changes

## Questions?

- Check [DEVELOPMENT.md](./DEVELOPMENT.md) for development workflows
- Open an issue for bugs or feature requests
- Join our Discord community for discussions
- Review existing PRs for examples

Thank you for contributing to Dexto! 🚀
*Tip:* Open an issue first for discussion on larger enhancements or proposals.
