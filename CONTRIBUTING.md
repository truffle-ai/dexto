# Contributing to Dexto

We welcome contributions! This guide will help you get started with contributing to the Dexto project.

## Table of Contents
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Code Standards](#code-standards)
- [Commit Guidelines](#commit-guidelines)
- [Changesets](#changesets)

## Getting Started

Before contributing, please:
1. Read our [Code of Conduct](./CODE_OF_CONDUCT.md)
2. Check existing [issues](https://github.com/dexto-ai/dexto/issues) and [pull requests](https://github.com/dexto-ai/dexto/pulls)
3. Open an issue for discussion on larger changes or enhancements

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
   git remote add upstream https://github.com/dexto-ai/dexto.git
   ```

### Install Dependencies

```bash
# Enable Corepack (built into Node.js 16+)
corepack enable

# Install dependencies (uses correct pnpm version automatically)
pnpm install

# Build all packages
pnpm run build
```

**Note**: Corepack ensures everyone uses the same pnpm version (10.12.4) as specified in package.json.

### Development Workflow

For detailed development workflows, see [DEVELOPMENT.md](./DEVELOPMENT.md). Quick start:

```bash
# Run development server with hot reload
pnpm run dev

# Or create a global symlink for CLI development
pnpm run link-cli
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
pnpm run typecheck

# Run tests
pnpm test

# Fix linting issues
pnpm run lint:fix

# Format code
pnpm run format

# Full validation (recommended before commits)
pnpm run build:check
```

## Submitting a Pull Request

### 1. Create a Changeset

For any changes that affect functionality:

```bash
pnpm changeset
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