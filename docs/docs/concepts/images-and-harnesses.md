---
sidebar_position: 5
---

# Images and Harnesses

:::tip New to Dexto?
For a complete understanding of how images fit into Dexto's architecture, see our [Understanding Architecture](../guides/understanding-architecture) guide.
:::

When building AI agents, you need infrastructure: storage for conversation history, database for sessions, tools for the agent to use, and plugins for custom behavior. Setting this up manually means writing the same boilerplate code in every project.

**Dexto images solve this problem.**

## What are Dexto Images?

A Dexto image is a distributable package that provides a complete agent harness - the runtime infrastructure your AI agents need to function. Think of it like choosing a Linux distribution for a server:

- **Ubuntu** is great for desktops
- **Alpine** is perfect for containers
- **Your custom distro** fits your organization's needs

Similarly, Dexto images package storage providers, database adapters, tools, and orchestration logic into a single npm package you can install and use immediately.

```typescript
// Without an image: 30+ lines of boilerplate
import { DextoAgent, blobStoreRegistry, databaseRegistry } from '@dexto/core';
import { localBlobProvider } from './providers/blob';
import { sqliteProvider } from './providers/database';
// ... 10 more imports and registrations

// With an image: 2 lines
import { createAgent } from '@dexto/image-local';
const agent = createAgent(config);
```

## Understanding the Harness

The harness is the runtime infrastructure that orchestrates your agent's capabilities. It manages:

- **Storage systems** - Blob storage for files, databases for sessions
- **Tool orchestration** - Registering and executing tools, managing tool lifecycle
- **Provider coordination** - Database adapters, cache implementations, compression strategies
- **Plugin infrastructure** - Event hooks, middleware, extensions

When you import an image, you're importing a pre-configured harness that handles all of this automatically. The image is the distribution mechanism; the harness is what runs.

## Official Images (Coming Soon)

Dexto will provide official images for common scenarios:

| Image | Use Case | Storage | Database | Best For |
|-------|----------|---------|----------|----------|
| `@dexto/image-local` | Development | Filesystem | SQLite | Prototypes, learning |
| `@dexto/image-cloud` | Production | S3 | Postgres | Scalable applications |
| `@dexto/image-edge` | Serverless | R2 | D1 | Edge functions |

## How Images Are Loaded

Dexto supports multiple patterns for loading images, giving you flexibility based on your use case:

### Pattern 1: Static Import (Type-Safe, Library Use)

For applications where you know exactly which image you need at build time:

```typescript
// Explicit environment setup
import '@dexto/image-local';
import { DextoAgent, loadAgentConfig } from '@dexto/core';

const config = await loadAgentConfig('./agent.yml');
const agent = new DextoAgent(config, './agent.yml');
```

**When to use:**
- Building a specific application
- Want TypeScript type safety and IDE support
- Know exactly which image you need
- Example: Your custom Discord bot or web server

### Pattern 2: Dynamic Loading (Flexible, CLI/Config-Driven)

For infrastructure and tooling that needs runtime flexibility:

```bash
# Via CLI flag (highest priority)
dexto --image @dexto/image-local run agent.yml

# Via agent config
image: '@dexto/image-local'

# Via environment variable
export DEXTO_IMAGE=@dexto/image-local
dexto run agent.yml
```

The CLI loads images dynamically with this priority:
1. `--image` CLI flag
2. `image` field in agent config
3. `DEXTO_IMAGE` environment variable
4. `@dexto/image-local` (default for convenience)

**Note:** Images are architecturally optional - agents can run with zero providers using `@dexto/core` directly. However, for convenience, the CLI defaults to `@dexto/image-local` unless you explicitly override it.

**When to use:**
- Building infrastructure or tooling
- Want runtime flexibility
- Support multiple deployment scenarios
- Example: The Dexto CLI tool itself, multi-tenant servers

### Pattern 3: Import from Image (All-in-One, Quick Start)

For the simplest possible experience:

```typescript
// Everything from the image
import { DextoAgent, loadAgentConfig } from '@dexto/image-local';

const config = await loadAgentConfig('./agent.yml');
const agent = new DextoAgent(config, './agent.yml');
```

Images re-export everything from core, so you can import directly from them.

**When to use:**
- Quick prototyping
- Getting started tutorials
- Don't care about the core vs image distinction
- Example: Learning Dexto, building small projects

### Understanding the Platform Model

In production deployments, think of the image as defining your **platform capabilities**:

```
Platform (Server) → Loads Image → Defines Capabilities
     ↓
Agent Configs → Use Available Capabilities
```

For example:
- A server running `@dexto/image-local` can host agents that need filesystem/process tools
- A server running `@dexto/image-cloud` can host agents that need S3/Postgres
- Each agent config declares its requirements, and the platform validates compatibility

This is similar to how Docker works - the platform (Docker host) defines what's available, and containers (agent configs) use those capabilities.

## Working with Images

You can use images in three ways:

1. **Use an official image** - Pre-built harness for getting started
2. **Extend at runtime** - Add custom tools to an official harness
3. **Build your own image** - Package a custom harness for your organization

See our [tutorials](../tutorials/images/01-using-dexto-image) for detailed walkthroughs of each approach.

## Next Steps

Ready to build with images? Check out our tutorials:

- [Using Dexto Images](../tutorials/images/01-using-dexto-image)
- [Adding Custom Tools](../tutorials/images/02-adding-custom-tools)
- [Building Your Own Image](../tutorials/images/03-building-your-image)
- [Building a Web App](../tutorials/images/04-building-web-app)
