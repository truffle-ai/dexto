# @dexto/image-local

Local development base image for Dexto agents.

## What is This?

A pre-configured backend surface for building agent applications locally. Like Alpine Linux but for AI agents - just import and start building.

## Features

- ✅ **SQLite Database** - Persistent local storage
- ✅ **Local Filesystem** - Blob storage in your project directory
- ✅ **In-Memory Cache** - Fast ephemeral caching
- ✅ **Offline-Capable** - No network dependencies
- ✅ **Zero Configuration** - Sensible defaults included

## Installation

```bash
pnpm add @dexto/image-local @dexto/core
```

## Quick Start

### 1. Create Agent Config

```yaml
# agents/default.yml
systemPrompt:
  contributors:
    - type: static
      content: |
        You are a helpful AI assistant.

llm:
  provider: anthropic
  model: claude-sonnet-4-5-20250514

# Storage uses image defaults - no need to specify!
```

### 2. Create Your App

```typescript
// index.ts
import { createAgent } from '@dexto/image-local';
import { loadAgentConfig } from '@dexto/agent-management';

const config = await loadAgentConfig('./agents/default.yml');

// Providers already registered! Just create and use.
const agent = createAgent(config, './agents/default.yml');
await agent.start();

// Run your agent
const response = await agent.run('Hello! Tell me about yourself.');
console.log(response.content);
```

### 3. Run

```bash
node index.ts
```

That's it! No provider registration, no boilerplate - the image handles it all.

## What's Included

### Registered Providers

- **Blob Storage**:
  - `local` - Local filesystem storage (default)
  - `in-memory` - Ephemeral memory storage

- **Database**:
  - `sqlite` - SQLite database (default)
  - `in-memory` - Ephemeral memory database

- **Cache**:
  - `in-memory` - In-memory cache (default)
  - `redis` - Redis cache (optional)

### Default Configuration

```yaml
storage:
  blob:
    type: local
    storePath: ./data/blobs

  database:
    type: sqlite
    path: ./data/agent.db

  cache:
    type: in-memory

logging:
  level: info
  fileLogging: true
```

## Customization

### Override Defaults

```yaml
# agents/custom.yml
storage:
  blob:
    type: local
    storePath: /custom/path  # Override default path

  database:
    type: in-memory  # Use in-memory instead of SQLite
```

### Add Custom Providers

```typescript
import { createAgent } from '@dexto/image-local';
import { customToolRegistry } from '@dexto/core';
import { myCustomTool } from './tools/custom.js';

// Extend the image with your own providers
customToolRegistry.register(myCustomTool);

// Create agent - has both image providers + your custom ones
const agent = createAgent(config);
```

## Use Cases

Perfect for:
- 🧪 Local development and testing
- 🖥️ Desktop applications
- 📝 Prototyping and experimentation
- 🎓 Learning and tutorials
- 🚫 Offline environments

Not suitable for:
- ❌ Production cloud deployments (use `@dexto/image-cloud`)
- ❌ Edge/serverless (use `@dexto/image-edge`)
- ❌ Multi-tenant systems (use `@dexto/image-cloud`)

## Image Metadata

```typescript
import { imageMetadata } from '@dexto/image-local';

console.log(imageMetadata);
// {
//   name: 'image-local',
//   version: '1.0.0',
//   target: 'local-development',
//   constraints: ['filesystem-required', 'offline-capable'],
//   builtAt: '2025-12-16T...',
//   coreVersion: '1.3.0'
// }
```

## Architecture

This image follows the base image pattern:

```
Your App (imports @dexto/image-local)
  ↓
Image Entry Point (dist/index.js)
  ├─ Side Effect: Register blob providers
  ├─ Side Effect: Log database/cache availability
  └─ Export: createAgent() factory
  ↓
@dexto/core
  ├─ DextoAgent class
  └─ Provider registries
```

When you import this image, providers are automatically registered. Just call `createAgent()` and build your UI.

## See Also

- [@dexto/image-cloud](../image-cloud) - Cloud production base image
- [@dexto/image-edge](../image-edge) - Edge/serverless base image
- [Architecture Docs](../../feature-plans/architecture/)

## License

MIT
