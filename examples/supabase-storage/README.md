# Dexto Distribution: Supabase Storage

> **A complete Dexto distribution with custom storage, tools, and multiple agent configurations**

This example demonstrates how to build a custom Dexto "flavor" (like creating Ubuntu on top of Linux). It includes:

- ✅ **Custom Storage** - Supabase blob storage with S3-compatible backend
- ✅ **Custom Tools** - DateTime Helper with timezone support
- ✅ **Multiple Agents** - Pre-configured agents for different use cases
- ✅ **Ready to Run** - Complete executable distribution

## Quick Start

```bash
# 1. Navigate to the example
cd examples/supabase-storage

# 2. Install dependencies
pnpm install

# 3. Set up environment
cp .env.example .env
# Add your ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_KEY

# 4. Build
pnpm run build

# 5. Run
pnpm start
```

## Running the Distribution

```bash
# Default agent
pnpm start

# Code reviewer agent (Opus model)
pnpm start agents/code-reviewer.yml

# Data analyst agent with custom message
pnpm start agents/data-analyst.yml "What time is it in Tokyo?"
```

**💡 Tip:** Agent YAML files can be added/modified without rebuilding TypeScript code.

## Project Structure

```
supabase-storage/
├── src/index.ts          # Entry point - demonstrates building the distribution
├── dexto.config.ts       # Provider registration hub
│
├── agents/               # Agent configurations (YAML - no rebuild needed)
│   ├── default.yml
│   ├── code-reviewer.yml
│   └── data-analyst.yml
│
├── storage/              # Custom storage implementations
│   ├── supabase-blob-store.ts
│   ├── supabase-provider.ts
│   └── supabase-storage.ts
│
├── tools/                # Custom tools
│   └── datetime-helper.ts
│
└── shared/               # Utilities
    ├── utils.ts
    └── constants.ts
```

## Included Agents

| Agent | Model | Use Case |
|-------|-------|----------|
| **default.yml** | Sonnet 4.5 | General purpose assistant |
| **code-reviewer.yml** | Opus 4.5 | Code review and deep analysis |
| **data-analyst.yml** | Sonnet 4.5 | Data analysis and reporting |

## How It Works

The entry point (`src/index.ts`) demonstrates the distribution pattern:

1. **Initialize** - `initialize()` sets up project-level configuration
2. **Register Providers** - `registerProviders()` makes custom storage/tools available
3. **Load Agent Config** - Reads YAML configuration at runtime
4. **Create Agent** - Instantiates agent with registered providers
5. **Run** - Executes interactions
6. **Cleanup** - `cleanup()` tears down gracefully

All custom providers are registered via `dexto.config.ts` before agent creation.

## Supabase Setup

### 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a project
2. Get your project URL and anon key from **Settings → API**

### 2. Create Storage Bucket

1. Go to **Storage** in Supabase dashboard
2. Create bucket named `dexto-blobs`
3. Set as Private or Public based on your needs

### 3. Set Up Database Table

Run this SQL in **SQL Editor**:

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

CREATE INDEX IF NOT EXISTS idx_blob_metadata_created_at ON blob_metadata(created_at);
CREATE INDEX IF NOT EXISTS idx_blob_metadata_hash ON blob_metadata(hash);
```

### 4. Configure Environment

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key-here
```

## Configuration Options

Storage configuration in agent YAML files:

```yaml
storage:
  blob:
    type: supabase
    supabaseUrl: $SUPABASE_URL
    supabaseKey: $SUPABASE_KEY
    bucket: dexto-blobs
    maxBlobSize: 52428800      # 50MB per blob
    maxTotalSize: 1073741824   # 1GB total
    cleanupAfterDays: 30       # Automatic cleanup
```

Custom tools configuration:

```yaml
customTools:
  - type: datetime-helper
    defaultTimezone: America/New_York
    includeMilliseconds: false
```

## Extending the Distribution

### Add a New Agent

Create a new YAML file (no rebuild needed):

```bash
# agents/customer-support.yml
systemPrompt:
  contributors:
    - id: primary
      type: static
      content: You are a helpful customer support agent...

llm:
  provider: anthropic
  model: claude-sonnet-4-5-20250514
  apiKey: $ANTHROPIC_API_KEY

storage:
  blob:
    type: supabase
    supabaseUrl: $SUPABASE_URL
    supabaseKey: $SUPABASE_KEY
    bucket: dexto-blobs

customTools:
  - type: datetime-helper
```

Run it immediately:
```bash
pnpm start agents/customer-support.yml
```

### Add a New Tool

1. Create `tools/my-tool.ts`:

```typescript
import { z } from 'zod';
import type { CustomToolProvider } from '@dexto/core';

const MyToolConfigSchema = z.object({
  type: z.literal('my-tool'),
  apiKey: z.string(),
}).strict();

export const myToolProvider: CustomToolProvider = {
  type: 'my-tool',
  configSchema: MyToolConfigSchema,
  create: (config, context) => [{
    id: 'do_something',
    description: 'Does something useful',
    inputSchema: z.object({ query: z.string() }),
    execute: async (input: unknown) => {
      // Your logic here
      return { result: 'done' };
    },
  }],
};
```

2. Register in `dexto.config.ts`:

```typescript
import { myToolProvider } from './tools/my-tool.js';

export function registerProviders() {
  customToolRegistry.register(myToolProvider);
  // ... other providers
}
```

3. Rebuild and use:

```bash
pnpm run build
```

## Features

**Storage:**
- Cloud-based (accessible from any environment)
- Content-based deduplication (SHA-256)
- Automatic cleanup of old blobs
- Multiple retrieval formats (base64, buffer, stream, signed URLs)

**Tools:**
- DateTime Helper with timezone support
- Extensible tool provider pattern
- Type-safe with Zod schemas

**Architecture:**
- Clean separation of concerns
- YAML-based agent configuration
- Provider pattern for extensibility
- No core modifications needed

## Development

```bash
# Build
pnpm run build

# Watch mode (auto-rebuild)
pnpm run dev

# Type check only
pnpm run typecheck

# Clean build artifacts
pnpm run clean
```

## Distribution Options

### As CLI Tool

Already configured! Install globally:

```bash
npm link
dexto-supabase agents/default.yml
```

### As npm Package

The package exports providers for use in other projects:

```typescript
import { registerProviders } from '@dexto/distribution-supabase/config';
import { supabaseBlobStoreProvider } from '@dexto/distribution-supabase/storage/supabase-storage';
import { dateTimeToolProvider } from '@dexto/distribution-supabase/tools/datetime-helper';
```

## Learn More

- [Dexto Core Documentation](https://docs.dexto.ai)
- [Custom Provider Pattern](../../docs/architecture/provider-pattern.md)
- [Supabase Storage Docs](https://supabase.com/docs/guides/storage)
