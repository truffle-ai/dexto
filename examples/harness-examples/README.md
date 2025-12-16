# Dexto Harness Examples

**Harness** = A pre-configured backend for Dexto agents (storage, database, cache, tools)

Think of it like choosing a Linux distribution: Ubuntu for desktops, Alpine for containers, your own for your organization.

## Structure

```
harness-examples/
├── 00-harness-implementation/  # Reference harness (used by examples 1 & 2)
├── 01-using-official-image/    # Pattern 1: Use a harness
├── 02-extending-image/         # Pattern 2: Extend a harness
└── 03-creating-custom-image/   # Pattern 3: Build your own harness
```

**Example 0** is the foundation - a complete harness implementation that Examples 1 and 2 build upon.

## The Three Patterns

### Pattern 1: Use a Harness → [Example 1](./01-using-official-image/)

**Use an official harness with defaults to start building apps quickly**

```typescript
import { createAgent } from '@dexto/image-local';
const agent = createAgent(config);
// Done! Storage, database, cache all configured.
```

**When:** Getting started, prototypes, simple apps

**Value:** Zero boilerplate, focus on your app logic

---

### Pattern 2: Extend a Harness → [Example 2](./02-extending-image/)

**Extend harness with custom providers based on needs - org, platform, services**

```typescript
import { createAgent } from '@dexto/image-local';
import { customToolRegistry } from '@dexto/core';
import { myWeatherTool } from './tools/weather.js';

// Add your custom provider to the harness
customToolRegistry.register(myWeatherTool);

// Agent has both: harness defaults + your custom providers
const agent = createAgent(config);
```

**When:** Need 1-3 custom providers, domain-specific tools, API integrations

**Value:** Reuse infrastructure, add your business logic

---

### Pattern 3: Implement Your Own Harness → [Example 3](./03-creating-custom-image/)

**Use the core to implement your own harness**

```typescript
// dexto.config.ts - Bundle all your providers
import { blobStoreRegistry, customToolRegistry } from '@dexto/core';
import { supabaseBlobProvider } from './storage/supabase.js';
import { dateTimeTool } from './tools/datetime.js';

export function registerProviders() {
    blobStoreRegistry.register(supabaseBlobProvider);
    customToolRegistry.register(dateTimeTool);
    // ... 10+ more providers for your org
}
```

**When:** Building platforms, organizational standards, 10+ custom providers

**Value:** Share infrastructure across teams, standardize on your stack

---

## The Architecture

```
┌─────────────────────────────────────────────────────┐
│ YOUR APPS (CLI, Web, Discord, Lambda)              │
│ What you build: UI + business logic                │
└──────────────────┬──────────────────────────────────┘
                   │ imports
┌──────────────────▼──────────────────────────────────┐
│ HARNESSES (Pre-configured Backends)                 │
│ - @dexto/image-local (SQLite + filesystem)         │
│ - @dexto/image-cloud (Postgres + S3)               │
│ - Your custom harness                               │
└──────────────────┬──────────────────────────────────┘
                   │ bundles & configures
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

# Build the reference harness (Example 0)
cd examples/harness-examples/00-harness-implementation
pnpm run build

# Set API key
export ANTHROPIC_API_KEY="your-key-here"

# Run examples
cd ../01-using-official-image && pnpm start
cd ../02-extending-image && pnpm start
cd ../03-creating-custom-image && pnpm start
```

## Learning Path

1. **Study Example 0** - Understand how harnesses are built (foundation)
2. **Run Example 1** - See how simple it is to use a harness
3. **Try Example 2** - Learn to add your own providers
4. **Study Example 3** - See alternative pattern for building harnesses

Each example's README has detailed explanations and code walkthroughs.

## Key Concepts

### Harness = Pre-configured Backend
- Like Docker base images or Linux distributions
- Bundles storage + database + cache + tools
- Ready to import and use

### Side-Effect Registration
```typescript
import { createAgent } from '@dexto/image-local';
// ↑ This import auto-registers all providers
const agent = createAgent(config);  // Ready to use!
```

### Provider = Implementation
- BlobStore: local, S3, Supabase, GCS
- Database: SQLite, Postgres, D1
- Tools: Your custom functionality

### Registry = Central Hub
```typescript
import { customToolRegistry } from '@dexto/core';
customToolRegistry.register(myTool);  // Now available to agents
```

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

### After (With Harness - 3 lines)

```typescript
import { createAgent } from '@dexto/image-local';
const agent = createAgent(config);
// All providers already registered!
```

**90% reduction in boilerplate**

## Decision Tree

**Building your first agent?**
→ Use Example 1 (official harness)

**Need 1-3 custom tools/providers?**
→ Use Example 2 (extend harness)

**Building a platform? Have 10+ providers? Need org standards?**
→ Use Example 3 (custom harness)

## Official Harnesses (Future)

When mature, harnesses will be published as:
- **`@dexto/image-local`** - Local dev (SQLite, filesystem, offline)
- **`@dexto/image-cloud`** - Production (Postgres, S3, scalable)
- **`@dexto/image-edge`** - Serverless (D1, R2, cold-start optimized)

For now, Example 0 serves as the reference implementation.

## Next Steps

- Read [Architecture Docs](../../feature-plans/architecture/)
- Study [Example 0 Implementation](./00-harness-implementation/)
- Learn [Provider Development](../../packages/core/src/providers/README.md)
- Read [Architecture Decisions](./ARCHITECTURE-DECISIONS.md)
