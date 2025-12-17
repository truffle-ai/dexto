# Dexto Image Examples

**Image** = A pre-configured, distributable backend for Dexto agents (storage, database, cache, tools)

Think of it like choosing a Linux distribution: Ubuntu for desktops, Alpine for containers, your own for your organization.

## Structure

```
harness-examples/
├── 00-building-image/          # Building an image from scratch
├── 01-using-official-image/    # Pattern 1: Use an image
├── 02-runtime-customization/   # Pattern 2: Runtime customization
└── 03-extending-image/         # Pattern 3: Extend into new image
```

**Example 0** is the foundation - a convention-based image implementation that the other examples build upon.

## The Four Patterns

### Pattern 0: Build an Image from Scratch → [Example 0](./00-building-image/)

**Create a base image using convention-based folders**

```typescript
// dexto.image.ts
export default defineImage({
  name: 'image-local',
  // Providers auto-discovered from:
  //   tools/*/index.ts
  //   blob-store/*/index.ts
  //   etc.
});
```

```bash
dexto-bundle build  # Creates dist/index.js
```

**When:** Building organizational standards, custom distributions

**Value:** Convention over configuration, auto-discovery, distributable

**Dependencies:** `@dexto/core` (dev only), `@dexto/bundler` (dev only)

---

### Pattern 1: Use an Image → [Example 1](./01-using-official-image/)

**Use an official image with defaults to start building apps quickly**

```typescript
import { createAgent } from '@dexto/image-local';
const agent = createAgent(config);
// Done! Storage, database, cache, tools all configured.
```

**When:** Getting started, prototypes, simple apps

**Value:** Zero boilerplate, focus on your app logic

**Dependencies:** None! Just the image package

---

### Pattern 2: Runtime Customization → [Example 2](./02-runtime-customization/)

**Add custom tools at runtime without building a new image**

```typescript
// Import from IMAGE, not @dexto/core!
import { createAgent, customToolRegistry } from '@dexto/image-local';
import { myWeatherTool } from './tools/weather.js';

// Add at runtime
customToolRegistry.register(myWeatherTool);

// Agent has: image providers + runtime additions
const agent = createAgent(config);
```

**When:** Need 1-2 app-specific tools, domain-specific functionality

**Value:** Reuse image infrastructure, add your business logic

**Dependencies:** None! Registries re-exported by image

**Key Difference:** This is RUNTIME (no build), not creating a new image

---

### Pattern 3: Extend an Image → [Example 3](./03-extending-image/)

**Create a NEW distributable image that inherits from a base**

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

**Dependencies:** `@dexto/core` (dev only), `@dexto/bundler` (dev only)

**Key Difference:** Builds a NEW IMAGE (distributable), not runtime customization

---

## Comparison Table

| Aspect | Use Image | Runtime Custom | Extend Image | Build Image |
|--------|-----------|----------------|--------------|-------------|
| **Example** | 01 | 02 | 03 | 00 |
| **Build Step?** | ❌ No | ❌ No | ✅ Yes | ✅ Yes |
| **@dexto/core?** | ❌ No | ❌ No | Dev only | Dev only |
| **Distributable?** | - | ❌ No | ✅ Yes | ✅ Yes |
| **When** | Start/prototype | App-specific | Org standard | Foundation |
| **Registries** | From image | From image | N/A | N/A |

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
pnpm --filter @dexto/bundler build

# Build the reference image (Example 0)
cd examples/harness-examples/00-building-image
pnpm run build

# Set API key
export OPENAI_API_KEY="your-key-here"

# Run examples
cd ../01-using-official-image && pnpm start
cd ../02-runtime-customization && pnpm start
```

## Learning Path

1. **Study Example 0** - Understand how images are built (convention-based)
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
import { createAgent } from '@dexto/image-local';
// ↑ This import auto-registers all providers
const agent = createAgent(config);  // Ready to use!
```

### Registry Re-exports (NEW!)
Images now re-export registries, so you don't need `@dexto/core`:

```typescript
// Import from IMAGE, not @dexto/core!
import { customToolRegistry } from '@dexto/image-local';
```

### Provider = Implementation
- BlobStore: local, S3, Supabase, GCS
- Database: SQLite, Postgres, D1
- Tools: Your custom functionality

## Before & After

### Before (Manual Setup - 30+ lines)

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

### After (With Image - 3 lines)

```typescript
import { createAgent } from '@dexto/image-local';
const agent = createAgent(config);
// All providers already registered!
```

**90% reduction in boilerplate**

## Decision Tree

**Building your first agent?**
→ Use Example 1 (official image)

**Need 1-2 app-specific tools?**
→ Use Example 2 (runtime customization)

**Creating org-wide standard with 3+ custom providers?**
→ Use Example 3 (extend into new image)

**Building completely custom distribution?**
→ Study Example 0, create your own base image

## Official Images (Future)

When mature, images will be published as:
- **`@dexto/image-local`** - Local dev (SQLite, filesystem, offline)
- **`@dexto/image-cloud`** - Production (Postgres, S3, scalable)
- **`@dexto/image-edge`** - Serverless (D1, R2, cold-start optimized)

For now, Example 0 serves as the reference implementation using convention-based structure.

## Next Steps

- Read [Architecture Docs](../../feature-plans/architecture/)
- Study [Example 0 Implementation](./00-building-image/)
- Learn [Provider Development](../../packages/core/src/providers/README.md)
- Read [Architecture Decisions](./ARCHITECTURE-DECISIONS.md)
