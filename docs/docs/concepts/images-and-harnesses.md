---
sidebar_position: 5
---

# Images and Harnesses

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

## Working with Images

You can use images in three ways:

1. **Use an official image** - Pre-built harness for getting started
2. **Extend at runtime** - Add custom tools to an official harness
3. **Build your own image** - Package a custom harness for your organization

See our [tutorials](/docs/tutorials/images/using-official-image) for detailed walkthroughs of each approach.

## Next Steps

Ready to build with images? Check out our tutorials:

- [Using an Official Image](/docs/tutorials/images/using-official-image)
- [Adding Custom Tools](/docs/tutorials/images/adding-custom-tools)
- [Building Your Own Image](/docs/tutorials/images/building-your-image)
- [Building a Web App](/docs/tutorials/images/building-web-app)
