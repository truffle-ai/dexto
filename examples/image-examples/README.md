# Dexto Image Examples

**Image** = A pre-configured, distributable package for Dexto agents (storage, database, cache, tools)

Think of it like choosing a Linux distribution: Ubuntu for desktops, Alpine for containers, your own for your organization.

## Structure

```
image-examples/
├── 01-using-official-image/    # Pattern 1: Use @dexto/image-local
├── 02-runtime-customization/   # Pattern 2: Add custom tools at runtime
├── 03-extending-image/         # Pattern 3: Create a new distributable image
└── 04-simple-server/           # Pattern 4: Web server with image
```

## The Four Patterns

---

### Pattern 1: Use an Image → [Example 1](./01-using-official-image/)

**Use an official image with defaults - this is what `dexto create-app` generates**

```typescript
// Static import for side-effect registration
import '@dexto/image-local';

import { DextoAgent } from '@dexto/core';
const agent = new DextoAgent(config);
// Done! Providers auto-registered, ready to use.
```

**agents/default.yml:**
```yaml
image: '@dexto/image-local'
```

**When:** Getting started, prototypes, simple apps

**Value:** Zero boilerplate, matches `create-app` output

**Command:** `dexto create-app my-app --from-image @dexto/image-local`

---

### Pattern 2: Runtime Customization → [Example 2](./02-runtime-customization/)

**Add custom tools at runtime without building a new image**

```typescript
// Import image for side-effect registration
import '@dexto/image-local';

import { DextoAgent, customToolRegistry } from '@dexto/core';
import { myWeatherTool } from './tools/weather.js';

// Add at runtime (before creating agent)
customToolRegistry.register(myWeatherTool);

// Agent has: image providers + runtime additions
const agent = new DextoAgent(config);
```

**agents/default.yml:**
```yaml
image: '@dexto/image-local'
customTools:
  - type: weather-helper
```

**When:** Need 1-2 app-specific tools, domain-specific functionality

**Value:** Instant iteration, no build step, easy testing

**Key Difference:** This is RUNTIME (no build), not creating a new image

---

### Pattern 3: Extend an Image → [Example 3](./03-extending-image/)

**Create a NEW distributable image that inherits from a base**

This is what `dexto create-image` generates for extending existing images.

```typescript
// dexto.image.ts
export default defineImage({
  name: 'image-weather',
  extends: '@dexto/image-local',  // Inherits everything
  // Custom providers auto-discovered from folders
});
```

```bash
dexto-bundle build  # Creates new image with base + custom
npm publish         # Share with org as @myorg/image-weather
```

**When:** Building platforms, organizational standards, sharing across 3+ apps

**Value:** Create org-specific images, share infrastructure across teams

**Command:** `dexto create-image my-org-image`

**Key Difference:** Builds a NEW IMAGE (distributable), not runtime customization

---

## Comparison Table

| Aspect | Use Image | Runtime Custom | Extend Image |
|--------|-----------|----------------|--------------|
| **Example** | 01 | 02 | 03 |
| **Build Step?** | ❌ No | ❌ No | ✅ Yes |
| **@dexto/core?** | ❌ No | ❌ No | Dev only |
| **Distributable?** | - | ❌ No | ✅ Yes |
| **When** | Start/prototype | App-specific | Org standard |
| **Registries** | From image | From image | N/A |

---

## Convention-Based Image Building

Images use a **folder-based convention** for automatic provider discovery - following the standard Node.js pattern:

```
my-image/
├── dexto.image.ts          # Just metadata + defaults
├── tools/                  # Auto-discovered ✨
│   ├── text-utils/
│   │   ├── index.ts        # Provider (auto-registered)
│   │   ├── helpers.ts      # Helper functions
│   │   └── types.ts        # Type definitions
│   └── weather/
│       └── index.ts        # Simple provider
├── blob-store/             # Auto-discovered ✨
│   └── supabase/
│       ├── index.ts        # Provider
│       └── client.ts       # Helper
├── compression/            # Auto-discovered ✨
│   └── sliding-window/
│       └── index.ts
└── plugins/                # Auto-discovered ✨
    └── audit-logger/
        └── index.ts
```

**Naming Convention (Node.js standard):**
- Each provider lives in its own folder
- `index.ts` is the provider implementation (auto-discovered)
- Other files in the folder are helpers (ignored unless imported)
- This is the standard Node.js pattern everyone knows

**Benefits:**
- ✅ Standard Node.js convention - no learning curve
- ✅ No manual provider registration
- ✅ Scales from simple (one file) to complex (many files)
- ✅ Helper files naturally organized with their provider
- ✅ Clear separation of concerns
- ✅ Just run `dexto-bundle build`

## The Architecture

```
┌─────────────────────────────────────────────────────┐
│ YOUR APPS (CLI, Web, Discord, Lambda)              │
│ What you build: UI + business logic                │
└──────────────────┬──────────────────────────────────┘
                   │ imports
┌──────────────────▼──────────────────────────────────┐
│ IMAGES (Convention-Based Bundles)                  │
│ - @dexto/image-local (SQLite + filesystem)         │
│ - @dexto/image-cloud (Postgres + S3)               │
│ - Your custom image                                 │
└──────────────────┬──────────────────────────────────┘
                   │ bundles & configures (auto)
┌──────────────────▼──────────────────────────────────┐
│ PROVIDERS (Implementations)                         │
│ Storage | Database | Cache | Tools | Plugins       │
└──────────────────┬──────────────────────────────────┘
                   │ implements
┌──────────────────▼──────────────────────────────────┐
│ CORE (Interfaces & Registries)                     │
│ IBlobStore | IDatabase | DextoAgent                │
└─────────────────────────────────────────────────────┘
```

## Quick Start

From Dexto root:

```bash
# Build dependencies
pnpm --filter @dexto/core build
pnpm --filter @dexto/agent-management build
pnpm --filter @dexto/image-local build
pnpm --filter @dexto/bundler build

# Set API key
export OPENAI_API_KEY="your-key-here"

# Run examples
cd examples/image-examples/01-using-official-image && pnpm start
cd ../02-runtime-customization && pnpm start
cd ../03-extending-image && pnpm run build  # Build the extended image
```

## Learning Path

1. **Study @dexto/image-local** - Understand how images are built (see `packages/image-local/`)
2. **Run Example 1** - See how simple it is to use an image
3. **Try Example 2** - Learn to add tools at runtime
4. **Study Example 3** - See how to extend into a new distributable image

Each example's README has detailed explanations and code walkthroughs.

## Key Concepts

### Image = Pre-configured, Distributable Backend
- Like Docker base images or Linux distributions
- Bundles storage + database + cache + tools
- Ready to import and use
- Can be published to npm

### Side-Effect Registration
```typescript
import '@dexto/image-local';
// ↑ This import auto-registers all providers

import { DextoAgent } from '@dexto/core';
const agent = new DextoAgent(config);  // Ready to use!
```

### Config-Based Image Loading
Images can also be loaded via config (recommended for flexibility):

```yaml
# agents/default.yml
image: '@dexto/image-local'
```

The CLI will load the image automatically based on priority:
1. CLI flag: `--image @dexto/image-local`
2. Config field: `image: '@dexto/image-local'`
3. Environment: `DEXTO_IMAGE=@dexto/image-local`
4. Default: `@dexto/image-local`

### Provider = Implementation
- BlobStore: local, S3, Supabase, GCS
- Database: SQLite, Postgres, D1
- Tools: Your custom functionality

## Before & After

### Before Images (Manual Setup - 30+ lines)

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

**~30 lines of boilerplate for every app!**

### After Images (Pattern 1 - Simple)

```typescript
// Static import - auto-registers providers
import '@dexto/image-local';

import { DextoAgent } from '@dexto/core';
const agent = new DextoAgent(config); // Providers already registered!
```

**Config:**
```yaml
image: '@dexto/image-local'
```

**85% reduction in boilerplate! 🎉**

## Decision Tree

**Building your first agent?**
→ Use Example 1 (official image)

**Need 1-2 app-specific tools?**
→ Use Example 2 (runtime customization)

**Creating org-wide standard with 3+ custom providers?**
→ Use Example 3 (extend into new image)

**Building completely custom base image?**
→ Study `@dexto/image-local` source (`packages/image-local/`), create your own base image

## Official Images

Available images:
- **`@dexto/image-local`** - Local dev (SQLite, filesystem tools, process tools, offline-capable)

Future images:
- **`@dexto/image-cloud`** - Production (Postgres, S3, scalable)
- **`@dexto/image-edge`** - Serverless (D1, R2, cold-start optimized)

See `packages/image-local/` for the reference implementation using convention-based structure.

## Next Steps

- Read [Architecture Docs](../../feature-plans/architecture/)
- Study [@dexto/image-local Implementation](../../packages/image-local/)
- Learn [Provider Development](../../packages/core/src/providers/README.md)
- Explore the [Base Images Architecture](../../feature-plans/architecture/02-base-images-and-implementation.md)
