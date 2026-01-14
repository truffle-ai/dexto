# Versioning and Release Process

This document describes the versioning strategy and release process for the Dexto monorepo.

## Overview

Dexto uses a monorepo structure with multiple packages:
- `dexto` (CLI) - Main package published to npm
- `@dexto/core` - Core library published to npm
- `@dexto/webui` - Web UI (private, not published)

We use [Changesets](https://github.com/changesets/changesets) for version management and coordinated releases.

## Versioning Strategy

### Fixed Versioning
The `dexto` and `@dexto/core` packages use **fixed versioning** - they always maintain the same version number. This ensures API compatibility between the CLI and core library.


## Automated Release Process (Recommended)

### 1. Create a Changeset

When you make changes that should trigger a release:

```bash
# Create a changeset describing your changes
pnpm changeset

# Follow the interactive prompts to:
# 1. Select which packages changed
# 2. Choose the version bump type (major/minor/patch)
# 3. Write a summary of changes
```

This creates a markdown file in `.changeset/` describing the changes.

> **Why Manual Changesets?** We require manual changeset creation to ensure developers think carefully about semantic versioning and write meaningful changelog entries for users.

### 2. Commit and Push to PR

```bash
# Add the changeset file
git add .changeset/*.md
git commit -m "chore: add changeset for [your feature]"
git push origin your-branch
```

### 3. Automatic Version and Release

When your PR with changesets is merged to `main`:

1. **Version PR Creation** (`changesets-publish.yml` triggers automatically)
   - Collects all pending changesets
   - Creates a "Version Packages" PR with:
     - Version bumps in package.json files
     - Updated CHANGELOG.md files
     - Consolidated changesets

2. **Review the Version PR**
   - Team reviews the version bumps
   - Can be merged immediately or held for batching multiple changes

3. **Automatic Publishing** (when Version PR is merged)
   - `changesets-publish.yml` triggers
   - Builds all packages
   - Publishes to npm registry
   - Creates git tags
   - Removes processed changeset files

### GitHub Workflows

#### Active Release Workflows:
- **[`require-changeset.yml`](.github/workflows/require-changeset.yml)** - Ensures PRs include changesets when needed
- **[`changesets-publish.yml`](.github/workflows/changesets-publish.yml)** - Opens a version bump PR, and publishes it when we merge the version bump PR (triggers on push to main)

#### Quality Check Workflows:
- **[`build_and_test.yml`](.github/workflows/build_and_test.yml)** - Runs tests on PRs
- **[`code-quality.yml`](.github/workflows/code-quality.yml)** - Runs linting and type checking

#### Documentation Workflows:
- **[`build-docs.yml`](.github/workflows/build-docs.yml)** - Builds documentation
- **[`deploy-docs.yml`](.github/workflows/deploy-docs.yml)** - Deploys documentation site

## Manual Release Process (Emergency Only)

If automated release fails or for emergency patches:

### Prerequisites

```bash
# Ensure you're on main and up to date
git checkout main
git pull origin main

# Install dependencies
pnpm install --frozen-lockfile

# Run all quality checks
pnpm run build
pnpm run lint
pnpm run typecheck
pnpm test
```

### Option 1: Manual Changeset Release

```bash
# 1. Create changeset manually
pnpm changeset

# 2. Version packages
pnpm changeset version

# 3. Commit version changes
git add -A
git commit -m "chore: version packages"

# 4. Build all packages
pnpm run build

# 5. Publish to npm
pnpm changeset publish

# 6. Push changes and tags
git push --follow-tags
```

### Option 2: Direct Version Bump (Not Recommended)

```bash
# 1. Update versions manually in package.json files
# IMPORTANT: Keep dexto and @dexto/core versions in sync!

# Edit packages/cli/package.json
# Edit packages/core/package.json

# 2. Install to update lockfile
pnpm install

# 3. Build packages
pnpm run build

# 4. Create git tag
git add -A
git commit -m "chore: release v1.2.0"
git tag v1.2.0

# 5. Publish packages
cd packages/core && pnpm publish --access public
cd ../cli && pnpm publish --access public

# 6. Push commits and tags
git push origin main --follow-tags
```

## Testing Releases (Without Publishing)

### Dry Run Commands

```bash
# See what would be published
pnpm publish -r --dry-run --no-git-checks

# Check changeset status
pnpm changeset status

# Preview version changes
pnpm changeset version --dry-run

# Test package contents
cd packages/cli && npm pack --dry-run
cd packages/core && npm pack --dry-run
```

### Local Testing

```bash
# Link packages locally for testing
pnpm run link-cli

# Test the linked CLI
dexto --version
```

## Release Checklist

Before any release:
- [ ] All tests passing (`pnpm test`)
- [ ] No lint errors (`pnpm run lint`)
- [ ] TypeScript compiles (`pnpm run typecheck`)
- [ ] Build succeeds (`pnpm run build`)
- [ ] Changeset created (if using automated flow)
- [ ] Version numbers synchronized (dexto and @dexto/core)

## Common Issues

### Issue: Versions out of sync
**Solution**: Ensure `dexto` and `@dexto/core` have the same version in their package.json files.

### Issue: Publish fails with "Package not found"
**Solution**: Run `pnpm run build` before publishing to ensure dist folders exist.

### Issue: Git working directory not clean
**Solution**: Commit or stash all changes before publishing. Use `--no-git-checks` flag for testing only.

### Issue: Authentication error when publishing
**Solution**: CI uses `NPM_TOKEN` secret (granular access token). Ensure the token is valid and has publish permissions for `@dexto` scope. For local publishing, use `npm login`.

## Version History

See package CHANGELOGs for detailed version history:

- packages/cli/CHANGELOG.md
- packages/core/CHANGELOG.md

## Questions?

For questions about the release process, please open an issue or consult the team.
