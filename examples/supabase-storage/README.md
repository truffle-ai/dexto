# Supabase Blob Storage Provider

This example demonstrates how to use Supabase Storage as a custom blob storage provider for Dexto agents. It showcases the provider pattern that allows extending Dexto with custom storage backends without modifying the core.

## Overview

The Supabase blob storage provider stores blob data in Supabase Storage (S3-compatible) with metadata in a Postgres database. This provides:

- ✅ Cloud-based storage (accessible from any environment)
- ✅ Content-based deduplication (via SHA-256 hashing)
- ✅ Automatic cleanup of old blobs
- ✅ Multiple retrieval formats (base64, buffer, stream, signed URLs)
- ✅ Database-backed metadata for efficient queries

## Architecture

This example is a **standalone application** completely separate from the Dexto CLI:

```
dexto/
├── packages/
│   ├── core/              # Core library (@dexto/core)
│   ├── cli/               # Official Dexto CLI (uses @dexto/core)
│   └── ...
└── examples/
    └── supabase-storage/  # YOUR custom app (uses @dexto/core)
        ├── src/
        │   ├── app.ts                  # Example application entry point
        │   ├── supabase-provider.ts    # Custom blob storage provider
        │   ├── supabase-blob-store.ts  # Supabase storage implementation
        │   └── index.ts                # Exports for reuse
        └── agent.yml                   # Agent configuration
```

**How it works:**

1. **Core exports registries** (`blobStoreRegistry`, `customToolRegistry`)
2. **You register custom providers** at your app startup
3. **Your agent config references them** (e.g., `storage.blob.type: supabase`)
4. **Core looks up and instantiates** the providers at runtime

This pattern allows you to:
- Build custom applications with Dexto (web servers, bots, CLIs)
- Extend Dexto with custom providers without modifying core
- Package and distribute your own Dexto-based tools

## Setup Instructions

### 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Wait for your project to be ready (this may take a few minutes)
3. Note your project URL and anon key from Settings → API

### 2. Create Storage Bucket

In your Supabase project:

1. Go to **Storage** in the left sidebar
2. Click **New bucket**
3. Name it `dexto-blobs` (or your preferred name)
4. Choose **Private** or **Public** based on your needs
5. Click **Create bucket**

### 3. Set Up Database Table

Go to **SQL Editor** in Supabase and run this SQL:

```sql
-- Create the blob metadata table
CREATE TABLE IF NOT EXISTS blob_metadata (
  id TEXT PRIMARY KEY,
  mime_type TEXT NOT NULL,
  original_name TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  size BIGINT NOT NULL,
  hash TEXT NOT NULL,
  source TEXT
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_blob_metadata_created_at ON blob_metadata(created_at);
CREATE INDEX IF NOT EXISTS idx_blob_metadata_hash ON blob_metadata(hash);
```

### 4. Configure Environment Variables

Create a `.env` file in your project root:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key-here
```

Or copy the provided template:

```bash
cp .env.example .env
# Edit .env with your actual values
```

### 5. Install Dependencies

```bash
npm install @dexto/core @supabase/supabase-js
```

### 6. Register the Provider

In your application startup code (before loading agent config):

```typescript
import { blobStoreRegistry } from '@dexto/core';
import { supabaseBlobStoreProvider } from '@dexto/examples-supabase-storage';

// Register the Supabase provider
blobStoreRegistry.register(supabaseBlobStoreProvider);
```

Or import from the source directly:

```typescript
import { blobStoreRegistry } from '@dexto/core';
import { supabaseBlobStoreProvider } from './path/to/supabase-storage/src/index.js';

blobStoreRegistry.register(supabaseBlobStoreProvider);
```

### 7. Configure Your Agent

Update your `agent.yml` to use Supabase blob storage:

```yaml
storage:
  cache:
    type: in-memory
  database:
    type: sqlite
  blob:
    type: supabase
    supabaseUrl: $SUPABASE_URL  # Loaded from environment
    supabaseKey: $SUPABASE_KEY  # Loaded from environment
    bucket: dexto-blobs
    maxBlobSize: 52428800       # 50MB per blob
    maxTotalSize: 1073741824    # 1GB total storage
    cleanupAfterDays: 30
    tableName: blob_metadata    # Optional, defaults to 'blob_metadata'
```

## Running the Example

This example includes a complete working application (`src/app.ts`) that demonstrates the Supabase blob storage integration:

```bash
# From the supabase-storage directory

# 1. Install dependencies
npm install

# 2. Build the TypeScript code
npm run build

# 3. Run the example app
npm start
```

The example app will:
1. Register the Supabase provider with the global registry
2. Load the `agent.yml` configuration
3. Create and start a DextoAgent
4. Send a message asking the agent to create a file
5. The file will be stored in Supabase Storage (not local filesystem)

**What to expect:**
- You'll see console output showing the registration, startup, and agent interaction
- The agent will create a blob in your Supabase bucket
- Check your Supabase dashboard under Storage → `dexto-blobs` to see the uploaded file
- Check the `blob_metadata` table in your Postgres database to see the metadata

**Using in your own app:**

See `src/app.ts` for the complete example. The key pattern is:

```typescript
import { DextoAgent, blobStoreRegistry } from '@dexto/core';
import { loadAgentConfig } from '@dexto/agent-management';
import { supabaseBlobStoreProvider } from './supabase-provider.js';

// 1. Register provider before creating agent
blobStoreRegistry.register(supabaseBlobStoreProvider);

// 2. Load config and create agent
const config = await loadAgentConfig('./agent.yml');
const agent = new DextoAgent(config, './agent.yml');

// 3. Start and use
await agent.start();
const response = await agent.run('Your message here');
await agent.stop();
```

## Configuration Options

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `type` | string | ✅ | - | Must be `'supabase'` |
| `supabaseUrl` | string | ✅ | - | Your Supabase project URL |
| `supabaseKey` | string | ✅ | - | Your Supabase anon/service key |
| `bucket` | string | ✅ | - | Storage bucket name |
| `pathPrefix` | string | ❌ | `undefined` | Optional path prefix for all blobs |
| `public` | boolean | ❌ | `false` | Whether to make blobs public |
| `maxBlobSize` | number | ❌ | `50MB` | Maximum size per blob (bytes) |
| `maxTotalSize` | number | ❌ | `1GB` | Maximum total storage (bytes) |
| `cleanupAfterDays` | number | ❌ | `30` | Days before old blobs are cleaned up |
| `tableName` | string | ❌ | `'blob_metadata'` | Postgres table name for metadata |

## Features

### Content-Based Deduplication

Blobs are deduplicated using SHA-256 hashing. If the same content is uploaded multiple times, only one copy is stored:

```typescript
const ref1 = await blobStore.store(buffer, { name: 'doc.pdf' });
const ref2 = await blobStore.store(buffer, { name: 'copy.pdf' });
// ref1.id === ref2.id (same hash, same blob)
```

### Multiple Retrieval Formats

Retrieve blobs in different formats based on your needs:

```typescript
// Base64 encoded (for embedding in JSON)
const base64 = await blobStore.retrieve(id, 'base64');

// Raw buffer (for processing)
const buffer = await blobStore.retrieve(id, 'buffer');

// Stream (for large files)
const stream = await blobStore.retrieve(id, 'stream');

// Signed URL (for secure sharing, 60min expiry)
const url = await blobStore.retrieve(id, 'url');
```

### Automatic Cleanup

Old blobs are automatically cleaned up based on `cleanupAfterDays`:

```typescript
// Called automatically or manually trigger
const deleted = await blobStore.cleanup();
console.log(`Cleaned up ${deleted} old blobs`);
```

## Migration from CLI

If you were previously using Supabase blob storage in the CLI (before it moved to examples), here's how to migrate:

### Before (CLI with built-in Supabase)

```yaml
# agents/default-agent.yml
storage:
  blob:
    type: supabase
    # ... config
```

### After (Custom provider)

1. **Install this example**:
   ```bash
   npm install @dexto/examples-supabase-storage
   ```

2. **Register the provider** in your app startup:
   ```typescript
   import { supabaseBlobStoreProvider } from '@dexto/examples-supabase-storage';
   import { blobStoreRegistry } from '@dexto/core';

   blobStoreRegistry.register(supabaseBlobStoreProvider);
   ```

3. **Keep your agent.yml the same** - configuration format is unchanged!

## Architecture

This example follows the Dexto provider pattern:

```
┌─────────────────────────────────────┐
│  Your Application                    │
│  ├─ Register provider at startup    │
│  └─ Load agent config               │
└─────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│  @dexto/core                         │
│  ├─ blobStoreRegistry                │
│  ├─ createBlobStore() factory       │
│  └─ BlobStore interface             │
└─────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│  Supabase Provider (this example)   │
│  ├─ Provider definition + schema    │
│  └─ SupabaseBlobStore implementation│
└─────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│  @supabase/supabase-js               │
│  ├─ Storage client                   │
│  └─ Database client                  │
└─────────────────────────────────────┘
```

## Troubleshooting

### Error: "Failed to access bucket"

**Cause**: Bucket doesn't exist or incorrect permissions.

**Solution**:
1. Verify bucket name matches your configuration
2. Check bucket exists in Supabase dashboard
3. Ensure your Supabase key has storage permissions

### Error: "Table 'blob_metadata' does not exist"

**Cause**: Database table not created.

**Solution**: Run the SQL schema creation script from step 3 above.

### Connection timeout

**Cause**: Network issues or incorrect URL.

**Solution**:
1. Verify `SUPABASE_URL` is correct
2. Check network connectivity
3. Ensure Supabase project is active (not paused)

## Security Considerations

- **Service Role Key**: For production, consider using the service role key instead of anon key for better control
- **Row Level Security (RLS)**: Enable RLS on the `blob_metadata` table for multi-tenant scenarios
- **Public Buckets**: Only use public buckets if you need direct public access to blobs
- **Signed URLs**: For private blobs, use signed URLs with appropriate expiry times

## Learn More

- [Dexto Provider Pattern Documentation](../../docs/architecture/provider-pattern.md)
- [Supabase Storage Documentation](https://supabase.com/docs/guides/storage)
- [Creating Custom Blob Providers](../../docs/extending/custom-blob-providers.md)
