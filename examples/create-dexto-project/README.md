# Creating a Dexto Project from Scratch

> **Pattern: Building a complete custom agent with custom providers**

This example demonstrates how to **build a full custom agent from scratch** using `@dexto/core`. You'll learn to:

- Implement custom providers (storage, tools, compression, plugins)
- Define agent configurations with YAML files
- Register providers manually via `dexto.config.ts`
- Build and bundle into a complete application

This is the "from-scratch" approach where you have full control over every provider. It's perfect for prototyping, learning, or building unique applications that don't fit standard image patterns.

**Note:** This uses manual provider registration. For creating reusable, distributable images, see the [harness-examples](../harness-examples/) folder which demonstrates the convention-based image bundler approach.

## Provider Types

| Type | Purpose | Example |
|------|---------|---------|
| **BlobStoreProvider** | Custom storage backends | Supabase, S3, GCS |
| **CustomToolProvider** | Tools the agent can use | DateTime helper, API integrations |
| **CompressionProvider** | Context management strategies | Sliding window, LLM summarization |
| **PluginProvider** | Hooks into agent execution | Audit logging, content filtering |

## Included Providers

### 1. Blob Storage: Supabase (`storage/`)
Cloud storage using Supabase Storage + Postgres for metadata.

### 2. Custom Tool: DateTime Helper (`tools/`)
Provides date/time utilities with timezone support.

### 3. Compression: Sliding Window (`compression/`)
Simple context compression by keeping N recent messages.

### 4. Plugin: Audit Logger (`plugins/`)
Logs all agent activity at all four extension points.

## Quick Start

```bash
# Navigate to example
cd examples/create-dexto-project

# Install dependencies
pnpm install

# Set up environment
cp .env.example .env
# Edit .env with your API keys

# Build
pnpm run build

# Run
pnpm start
```

## Project Structure

```
create-dexto-project/
├── dexto.config.ts           # Provider registration hub
├── src/index.ts              # Entry point
│
├── storage/                  # Blob Storage Providers
│   └── supabase-blob-provider.ts
│
├── tools/                    # Custom Tool Providers
│   └── datetime-helper.ts    # DateTime utilities
│
├── compression/              # Compression Providers
│   └── sliding-window-provider.ts
│
├── plugins/                  # Plugin Providers
│   └── audit-logger-provider.ts
│
├── agents/                   # Agent Configurations
│   ├── default.yml
│   ├── code-reviewer.yml
│   └── data-analyst.yml
│
└── shared/                   # Utilities
    ├── utils.ts
    └── constants.ts
```

## Creating Each Provider Type

### 1. Blob Storage Provider

```typescript
// storage/my-storage.ts
import { z } from 'zod';
import type { BlobStoreProvider, IBlobStore } from '@dexto/core';

const ConfigSchema = z.object({
    type: z.literal('my-storage'),
    apiKey: z.string(),
    bucket: z.string(),
}).strict();

class MyBlobStore implements IBlobStore {
    // Implement: store, retrieve, delete, list, getUrl, getMetadata
}

export const myStorageProvider: BlobStoreProvider<'my-storage'> = {
    type: 'my-storage',
    configSchema: ConfigSchema,
    create: (config, logger) => new MyBlobStore(config, logger),
    metadata: {
        displayName: 'My Storage',
        description: 'Custom blob storage',
        requiresNetwork: true,
    },
};
```

**YAML Usage:**
```yaml
storage:
  blob:
    type: my-storage
    apiKey: $MY_STORAGE_API_KEY
    bucket: my-bucket
```

### 2. Custom Tool Provider

```typescript
// tools/my-tool.ts
import { z } from 'zod';
import type { CustomToolProvider, InternalTool } from '@dexto/core';

const ConfigSchema = z.object({
    type: z.literal('my-tool'),
    apiKey: z.string(),
}).strict();

export const myToolProvider: CustomToolProvider<'my-tool'> = {
    type: 'my-tool',
    configSchema: ConfigSchema,
    create: (config, context) => [{
        id: 'do_something',
        description: 'Does something useful',
        inputSchema: z.object({ query: z.string() }),
        execute: async (input) => ({ result: 'done' }),
    }],
    metadata: {
        displayName: 'My Tool',
        description: 'Custom tool',
        category: 'utilities',
    },
};
```

**YAML Usage:**
```yaml
customTools:
  - type: my-tool
    apiKey: $MY_TOOL_API_KEY
```

### 3. Compression Provider

```typescript
// compression/my-compression.ts
import { z } from 'zod';
import type { CompressionProvider, ICompressionStrategy } from '@dexto/core';

const ConfigSchema = z.object({
    type: z.literal('my-compression'),
    threshold: z.number().default(100),
}).strict();

class MyStrategy implements ICompressionStrategy {
    readonly name = 'my-compression';
    compress(history) {
        // Return summary messages to add
        return [];
    }
}

export const myCompressionProvider: CompressionProvider<'my-compression'> = {
    type: 'my-compression',
    configSchema: ConfigSchema,
    create: (config, context) => new MyStrategy(config, context),
    metadata: {
        displayName: 'My Compression',
        description: 'Custom compression strategy',
        requiresLLM: false,
        isProactive: false,
    },
};
```

**YAML Usage:**
```yaml
context:
  compression:
    type: my-compression
    threshold: 50
```

### 4. Plugin Provider

```typescript
// plugins/my-plugin.ts
import { z } from 'zod';
import type { PluginProvider, DextoPlugin, PluginResult } from '@dexto/core';

const ConfigSchema = z.object({
    type: z.literal('my-plugin'),
    enabled: z.boolean().default(true),
}).strict();

class MyPlugin implements DextoPlugin {
    async beforeLLMRequest(payload, context): Promise<PluginResult> {
        // Hook before LLM call
        return { ok: true };
    }

    async beforeToolCall(payload, context): Promise<PluginResult> {
        // Hook before tool execution
        return { ok: true };
    }

    async afterToolResult(payload, context): Promise<PluginResult> {
        // Hook after tool execution
        return { ok: true };
    }

    async beforeResponse(payload, context): Promise<PluginResult> {
        // Hook before sending response
        return { ok: true };
    }
}

export const myPluginProvider: PluginProvider<'my-plugin'> = {
    type: 'my-plugin',
    configSchema: ConfigSchema,
    create: (config, context) => new MyPlugin(config, context),
    metadata: {
        displayName: 'My Plugin',
        description: 'Custom plugin',
        extensionPoints: ['beforeLLMRequest', 'beforeToolCall', 'afterToolResult', 'beforeResponse'],
        category: 'custom',
    },
};
```

**YAML Usage:**
```yaml
plugins:
  registry:
    - type: my-plugin
      priority: 50
      blocking: false
      config:
        enabled: true
```

## Registering Providers

All providers are registered in `dexto.config.ts`:

```typescript
import {
    blobStoreRegistry,
    customToolRegistry,
    compressionRegistry,
    pluginRegistry,
} from '@dexto/core';

export function registerProviders() {
    blobStoreRegistry.register(myStorageProvider);
    customToolRegistry.register(myToolProvider);
    compressionRegistry.register(myCompressionProvider);
    pluginRegistry.register(myPluginProvider);
}
```

## Running Different Agents

```bash
# Default agent
pnpm start

# Code reviewer (Opus model)
pnpm start agents/code-reviewer.yml

# Data analyst with custom message
pnpm start agents/data-analyst.yml "What time is it in Tokyo?"
```

**Tip:** Agent YAML files can be added/modified without rebuilding.

## Supabase Setup (for blob storage)

### 1. Create Project
Go to [supabase.com](https://supabase.com) and create a project.

### 2. Create Storage Bucket
In Supabase dashboard: **Storage → Create bucket** named `dexto-blobs`

### 3. Create Metadata Table
Run in **SQL Editor**:

```sql
CREATE TABLE IF NOT EXISTS blob_metadata (
    id TEXT PRIMARY KEY,
    mime_type TEXT NOT NULL,
    original_name TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    size BIGINT NOT NULL,
    hash TEXT NOT NULL,
    source TEXT
);

CREATE INDEX idx_blob_metadata_created_at ON blob_metadata(created_at);
CREATE INDEX idx_blob_metadata_hash ON blob_metadata(hash);
```

### 4. Configure Environment
```bash
ANTHROPIC_API_KEY=sk-ant-...
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key
```

## Development

```bash
pnpm run build      # Build TypeScript
pnpm run dev        # Watch mode
pnpm run typecheck  # Type check only
pnpm run clean      # Clean build artifacts
```

## From Bundle to Image

This example uses **manual registration** for demonstration. To convert it into a distributable base image:

### 1. Create `dexto.image.ts`

```typescript
import { defineImage } from '@dexto/core';

export default defineImage({
  name: 'enterprise',
  version: '1.0.0',
  description: 'Enterprise image with Supabase and custom tools',

  providers: {
    blobStore: {
      register: async () => {
        const { supabaseBlobStoreProvider } = await import('./storage/supabase-blob-provider.js');
        blobStoreRegistry.register(supabaseBlobStoreProvider);
      },
    },
    customTools: {
      register: async () => {
        const { dateTimeToolProvider } = await import('./tools/datetime-helper.js');
        customToolRegistry.register(dateTimeToolProvider);
      },
    },
    // ... more providers
  },

  defaults: {
    storage: {
      blob: { type: 'supabase' },
    },
  },

  constraints: ['cloud-required', 'network-required'],
});
```

### 2. Build with Bundler

```bash
pnpm run build  # Uses @dexto/image-bundler
```

### 3. Publish to npm

```bash
npm publish  # Now @myorg/image-enterprise
```

### 4. Use in Apps

```typescript
import { createAgent } from '@myorg/image-enterprise';
const agent = createAgent(config);  // All providers auto-registered!
```

## When to Use This Approach

**Use this from-scratch approach** when:
- Learning how Dexto works internally
- Prototyping and experimenting with custom providers
- Building a unique application with specific requirements
- Your providers are still in active development
- You need full control over the entire stack

**Use base images instead** when:
- You want to get started quickly with sensible defaults
- Your use case fits a standard pattern (local dev, cloud production, etc.)
- You want to add just 1-2 custom tools to an existing image
- See [harness-examples](../harness-examples/) for image-based patterns

## Learn More

- [Harness Examples](../harness-examples/) - Convention-based image building
- [Base Images Architecture](../../feature-plans/architecture/02-base-images-and-implementation.md)
- [Provider Development Guide](../../packages/core/src/providers/README.md)
