# Dexto CLI Commands Guide

> **Reference documentation for the redesigned CLI project creation commands**
>
> This guide documents the semantics, decision tree, and usage patterns for Dexto's project creation commands. Use this as source material for updating user-facing documentation.

## Table of Contents

- [Terminology: Image vs Harness](#terminology-image-vs-harness)
- [User Decision Tree](#user-decision-tree)
- [CLI Commands Overview](#cli-commands-overview)
- [Command Details](#command-details)
- [Usage Examples](#usage-examples)
- [Folder Structure Conventions](#folder-structure-conventions)
- [Migration Guide](#migration-guide)

---

## Terminology: Image vs Harness

### Semantic Split Strategy

We use **two complementary terms** to describe Dexto's architecture:

| Term | Used For | Examples |
|------|----------|----------|
| **Image** | Distributable artifacts, packages, composition | Package names (`@dexto/image-local`), CLI commands (`create-image`), "install the image", "build an image" |
| **Harness** | Runtime behavior, what it provides | "The harness manages providers", "complete agent harness", technical architecture docs |

### Bridge Phrase

> **"A Dexto image provides a complete agent harness"**

This connects the user-facing concept (image) with the technical implementation (harness).

### Usage Guidelines

**Use "Image" when:**
- Talking to users about packages they install
- Naming CLI commands and flags
- Describing distribution and composition
- Making analogies to Docker images or OS images
- Writing getting-started guides and tutorials

**Use "Harness" when:**
- Explaining runtime behavior and architecture
- Documenting how providers work together
- Writing technical architecture documentation
- Describing what the image provides under the hood

**Examples:**

```markdown
✅ Good: "Install the @dexto/image-local package to get a complete harness with SQLite and local filesystem storage."

✅ Good: "The image provides a pre-configured harness that manages your providers, context, and tool orchestration."

❌ Avoid: "Install the harness" (use "image")
❌ Avoid: "Build an image that orchestrates tools" (say "harness" for behavior)
```

---

## User Decision Tree

```
┌─────────────────────────────────────────────────┐
│ What are you building?                          │
└─────────────────────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        │            │            │
        ▼            ▼            ▼
   [APP]       [IMAGE]     [PROJECT]
 (runnable) (distributable) (advanced)
```

### When to Use Each Command

#### 1. Building an APP → `dexto create-app`

**Choose this when:** You're building a runnable application (CLI tool, web service, bot, etc.)

**Three modes available:**

**Mode A: Use Official Image** (80% of users)
- **Flag:** `--from-image` (default)
- **Best for:** Getting started, prototypes, standard use cases
- **What you get:** Pre-built harness, zero boilerplate
- **Dependencies:** Just the image package
- **Example:** `dexto create-app my-chatbot`

**Mode B: Extend Official Image** (15% of users)
- **Flag:** `--extend-image`
- **Best for:** Need 1-3 app-specific tools, custom business logic
- **What you get:** Image + convention-based folders for custom providers
- **Dependencies:** Base image + @dexto/bundler
- **Example:** Add a weather API tool to the local image

**Mode C: Build from Core** (5% of users - advanced)
- **Flag:** `--from-core`
- **Best for:** Learning internals, unique requirements, full control
- **What you get:** Manual provider registration, complete flexibility
- **Dependencies:** @dexto/core only
- **Warning:** Shows advanced pattern notice

---

#### 2. Building an IMAGE → `dexto create-image`

**Choose this when:** You're creating a distributable harness package for reuse

**Two modes available:**

**Mode A: New Base Image**
- **Best for:** Building organizational standards, custom distributions
- **What you get:** Convention-based structure, auto-discovery
- **Publish to:** npm for team/org consumption
- **Example:** `@myorg/image-healthcare` for healthcare apps

**Mode B: Extend Existing Image**
- **Flag:** `--extends`
- **Best for:** Adding providers to existing image, platform building
- **What you get:** Base image + your custom providers
- **Publish to:** npm as new image
- **Example:** `@myorg/image-local-plus` extends `@dexto/image-local`

**When to build an image:**
- Sharing infrastructure across 3+ applications
- Building a platform for your organization
- Creating domain-specific harnesses (e.g., healthcare, finance)
- Standardizing storage/tools/plugins across teams

---

#### 3. Building a PROJECT → `dexto create-project`

**Choose this when:** You need manual provider registration (advanced pattern)

**⚠️ Advanced Pattern Warning:**
- Shows warning message on creation
- Recommends `create-image` or `create-app --extend-image` instead
- Requires manual registration in `dexto.config.ts`

**Best for:**
- Prototyping new provider types
- Learning how Dexto works internally
- Building completely custom distributions
- Research and experimentation

**Not recommended for:**
- Production applications (use `create-app`)
- Distributable packages (use `create-image`)

---

## CLI Commands Overview

### Command Comparison

| Command | Purpose | Output | Distributable | Build Step |
|---------|---------|--------|---------------|------------|
| `create-app` | Runnable application | Executable app | ❌ No | Depends on mode |
| `create-image` | Reusable harness package | npm package | ✅ Yes | ✅ Yes (`dexto-bundle`) |
| `create-project` | Manual registration | Custom setup | ❌ No | ✅ Yes (tsc) |

### Command Hierarchy

```
dexto
├── create-app [name]           # Primary command - build applications
│   ├── --from-image           # Mode A: Use image (default)
│   ├── --extend-image         # Mode B: Extend image
│   └── --from-core            # Mode C: From core (advanced)
│
├── create-image [name]         # Build distributable harness packages
│   └── --extends              # Extend existing image
│
└── create-project [name]       # Advanced: manual registration
```

---

## Command Details

### `dexto create-app [name]`

Creates a runnable Dexto application.

**Interactive Prompts:**
1. Project name (validated)
2. **How do you want to start?**
   - Use official image (fastest, recommended)
   - Extend official image (add custom providers)
   - Build from core (advanced, full control)
3. **Which base image?** (for modes A & B)
   - @dexto/image-local (recommended) - SQLite, filesystem
   - @dexto/image-cloud - Postgres, S3
   - @dexto/image-edge - D1, R2
   - Custom npm package...
4. **Include example custom tool?** (mode B only)

**Generated Structure (Mode A - from-image):**
```
my-app/
├── src/
│   └── index.ts              # Uses image harness
├── agents/
│   └── default.yml           # Agent configuration
├── .env.example
├── package.json              # Deps: image package
├── tsconfig.json
└── README.md
```

**Generated Structure (Mode B - extend-image):**
```
my-app/
├── tools/                    # Auto-discovered providers
│   └── example-tool/
├── blob-store/
├── compression/
├── plugins/
├── agents/
│   └── default.yml
├── dexto.image.ts            # Extends base image
├── package.json              # Deps: base + bundler
├── tsconfig.json
└── README.md
```

**Scripts Generated:**
- Mode A: `start: tsx src/index.ts`
- Mode B: `build: dexto-bundle build`, `start: pnpm run build && node dist/index.js`
- Mode C: Uses existing init-app scripts

---

### `dexto create-image [name]`

Creates a distributable Dexto image (harness package).

**Interactive Prompts:**
1. Image name (validated)
2. Description
3. **Starting point:**
   - New base image (build from scratch)
   - Extend existing image (add providers to base)
4. **Which base image?** (if extending)
5. **Target environment:**
   - Local development
   - Cloud production
   - Edge/serverless
   - Custom
6. **Include example tool provider?**

**Generated Structure:**
```
my-image/
├── tools/                    # Convention-based folders
│   └── example-tool/
│       └── index.ts          # Auto-discovered
├── blob-store/
├── compression/
├── plugins/
├── dexto.image.ts            # Image definition
├── package.json              # With bundler scripts
├── tsconfig.json
└── README.md
```

**Key Files:**

**`dexto.image.ts`:**
```typescript
import { defineImage } from '@dexto/core';

export default defineImage({
    name: 'my-image',
    version: '1.0.0',
    description: 'Custom agent harness',
    target: 'local-development',

    // Optional - extends base image
    extends: '@dexto/image-local',

    // Providers auto-discovered from:
    //   tools/*/index.ts
    //   blob-store/*/index.ts
    //   compression/*/index.ts
    //   plugins/*/index.ts

    defaults: {
        storage: {
            blob: { type: 'local' },
            database: { type: 'sqlite' },
        },
    },

    constraints: ['filesystem-required'],
});
```

**Scripts Generated:**
- `build: dexto-bundle build` - Creates dist/index.js with side-effect registration
- `typecheck: tsc --noEmit`

**Publishing:**
```bash
npm publish
# Now available as: npm install my-image
```

---

### `dexto create-project [name]`

Creates a project with manual provider registration (advanced).

**⚠️ Shows Warning:**
```
⚠️  Advanced Pattern: Manual Provider Registration

This creates a project with manual provider registration.

Consider using:
  • `dexto create-image` for distributable harness packages
  • `dexto create-app --extend-image` for app-specific tools

Continue with manual registration project? (y/N)
```

**Generated Structure:**
```
my-project/
├── src/
│   └── index.ts
├── agents/
│   └── default.yml
├── storage/                  # Manual provider folders
├── tools/
├── plugins/
├── shared/
├── dexto.config.ts           # Manual registration
├── package.json
└── README.md
```

**Key Files:**

**`dexto.config.ts`:**
```typescript
import {
    blobStoreRegistry,
    customToolRegistry,
    pluginRegistry,
} from '@dexto/core';

export function registerProviders() {
    // Manual registration here
    // blobStoreRegistry.register(myProvider);
}
```

---

## Usage Examples

### Example 1: Simple Chatbot (Mode A - from-image)

```bash
$ dexto create-app my-chatbot

How do you want to start?
❯ Use official image (fastest, recommended)
  Extend official image (add custom providers)
  Build from core (advanced, full control)

Which base image?
❯ @dexto/image-local (recommended)
  @dexto/image-cloud
  @dexto/image-edge
  Custom npm package...

✓ Successfully created app: my-chatbot

Next steps:
  $ cd my-chatbot
  $ pnpm start
```

**Result:** App with pre-configured harness, zero custom code needed.

---

### Example 2: Add Weather API Tool (Mode B - extend-image)

```bash
$ dexto create-app weather-bot

How do you want to start?
  Use official image (fastest, recommended)
❯ Extend official image (add custom providers)
  Build from core (advanced, full control)

Which base image?
❯ @dexto/image-local (recommended)

Include example custom tool?
❯ Yes

✓ Successfully created app: weather-bot

Next steps:
  $ cd weather-bot
  $ pnpm run build
  $ pnpm start
```

**Edit `tools/weather-api/index.ts`:**
```typescript
import { z } from 'zod';
import type { CustomToolProvider } from '@dexto/core';

export const weatherApiProvider: CustomToolProvider<'weather-api'> = {
    type: 'weather-api',
    configSchema: z.object({ type: z.literal('weather-api') }),

    create: (config, context) => [{
        id: 'get_weather',
        description: 'Get current weather for a location',
        inputSchema: z.object({ location: z.string() }),
        execute: async ({ location }) => {
            // Call weather API
            return { temperature: 72, conditions: 'Sunny' };
        },
    }],

    metadata: {
        displayName: 'Weather API',
        description: 'Weather data provider',
        category: 'utilities',
    },
};
```

**Result:** Custom tool auto-discovered and available to the agent.

---

### Example 3: Organization-Wide Image

```bash
$ dexto create-image healthcare-image

Starting point:
❯ New base image (build from scratch)
  Extend existing image (add providers to base)

Target environment:
❯ Cloud production

Include example tool provider?
❯ No

✓ Successfully created image: healthcare-image
```

**Add HIPAA-compliant storage in `blob-store/hipaa-storage/index.ts`:**
```typescript
import type { BlobStoreProvider, IBlobStore } from '@dexto/core';

export const hipaaStorageProvider: BlobStoreProvider<'hipaa-storage'> = {
    type: 'hipaa-storage',
    // ... implementation
};
```

**Publish and share:**
```bash
$ pnpm run build
$ npm publish
# Now team uses: npm install @myorg/healthcare-image
```

---

### Example 4: Learning Pattern (Mode C - from-core)

```bash
$ dexto create-app learning-project

How do you want to start?
  Use official image (fastest, recommended)
  Extend official image (add custom providers)
❯ Build from core (advanced, full control)

⚠️  Advanced Pattern: Manual Harness Construction
You will build a custom harness directly from @dexto/core.

✓ Successfully created app: learning-project
```

**Result:** Full control, manual provider registration in `dexto.config.ts`.

---

## Folder Structure Conventions

### Convention-Based Auto-Discovery

Images and extended apps use **folder-based conventions** for automatic provider discovery:

```
project/
├── tools/                    # Custom tool providers
│   ├── weather-api/
│   │   ├── index.ts         # Provider (auto-discovered)
│   │   ├── helpers.ts       # Helper functions
│   │   └── types.ts         # Type definitions
│   └── slack-integration/
│       └── index.ts
│
├── blob-store/              # Blob storage providers
│   └── s3-provider/
│       └── index.ts
│
├── compression/             # Compression strategies
│   └── sliding-window/
│       └── index.ts
│
└── plugins/                 # Plugin providers
    └── audit-logger/
        └── index.ts
```

**Naming Convention (Node.js standard):**
- Each provider lives in its own folder
- `index.ts` is the provider implementation (auto-discovered by bundler)
- Other files in the folder are helpers (ignored unless imported)
- This is the standard Node.js pattern everyone knows

**Benefits:**
- ✅ Standard Node.js convention - no learning curve
- ✅ No manual provider registration needed
- ✅ Scales from simple (one file) to complex (many files)
- ✅ Helper files naturally organized with their provider
- ✅ Clear separation of concerns

---

## Migration Guide

### From Old `create-distro` Command

**Old command:**
```bash
dexto create-distro my-distribution
```

**New equivalent:**
```bash
dexto create-project my-project  # With warning message
```

**Recommended instead:**
```bash
# For distributable packages:
dexto create-image my-image

# For apps with custom tools:
dexto create-app my-app
# Choose: Extend official image
```

### From Manual Setup to Images

**Before (30+ lines of boilerplate):**
```typescript
import { DextoAgent, blobStoreRegistry } from '@dexto/core';
import { localBlobProvider } from './providers/blob';
import { sqliteProvider } from './providers/database';
// ... 10 more imports

// Manual registration
blobStoreRegistry.register(localBlobProvider);
databaseRegistry.register(sqliteProvider);
// ... 10 more registrations

const agent = new DextoAgent(config);
```

**After (3 lines with image):**
```typescript
import { createAgent } from '@dexto/image-local';
const agent = createAgent(config);
// All providers already registered!
```

**90% reduction in boilerplate**

---

## Design Principles

### 1. Progressive Complexity
- Start simple (use image) → Add custom tools (extend) → Full control (from-core)
- Each level reveals more complexity only when needed

### 2. Convention Over Configuration
- Auto-discovery from folder structure
- No manual registration for images
- Standard Node.js patterns

### 3. Clear Terminology
- "Image" for user-facing artifacts
- "Harness" for technical implementation
- Consistent across CLI, docs, and code

### 4. Sensible Defaults
- Recommend `@dexto/image-local` for local dev
- Default to simplest mode (from-image)
- Warn before advanced patterns

### 5. Composability
- Images can extend other images
- Apps can use or extend images
- Manual projects for complete flexibility

---

## Future Official Images

When mature, these images will be published:

| Image | Use Case | Storage | Database | Best For |
|-------|----------|---------|----------|----------|
| `@dexto/image-local` | Local development | Filesystem | SQLite | Prototypes, learning |
| `@dexto/image-cloud` | Cloud production | S3 | Postgres | Scalable apps |
| `@dexto/image-edge` | Serverless | R2 | D1 | Edge functions |

---

## Quick Reference

### Command Cheatsheet

```bash
# Create runnable application
dexto create-app my-app                    # Interactive mode
dexto create-app my-app --from-image       # Use image (default)
dexto create-app my-app --extend-image     # Extend image
dexto create-app my-app --from-core        # From core (advanced)

# Create distributable image
dexto create-image my-image                # Interactive mode
dexto create-image my-image --extends=@dexto/image-local

# Create manual registration project (advanced)
dexto create-project my-project            # Shows warning
```

### Decision Flowchart

```
Need to build something?
│
├─ Runnable app? → create-app
│  ├─ Just use it? → from-image
│  ├─ Add 1-3 tools? → extend-image
│  └─ Full control? → from-core
│
├─ Reusable package? → create-image
│  ├─ From scratch? → new base
│  └─ Add to existing? → extends
│
└─ Learn internals? → create-project
   └─ Shows warning first
```

---

## Related Documentation

- **Architecture Docs**: `feature-plans/architecture/02-base-images-and-implementation.md`
- **Examples**: `examples/image-examples/` (formerly `harness-examples/`)
- **Provider Development**: `packages/core/src/providers/README.md`
- **Bundler Documentation**: `packages/bundler/README.md`

---

**Last Updated**: December 17, 2025
**Version**: 1.0.0
**Authors**: Dexto Team
