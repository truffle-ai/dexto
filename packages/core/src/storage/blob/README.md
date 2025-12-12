# Blob Storage Provider Pattern

This module implements a flexible blob storage system using a provider pattern, allowing custom storage backends to be registered at runtime while maintaining type safety and validation.

## Architecture

```
┌─────────────────────────────────────────┐
│  Core Package                           │
│  - BlobStore interface                  │
│  - BlobStoreProvider interface          │
│  - Global registry (singleton)          │
│  - Built-in providers (local, memory)   │
│  - createBlobStore(config, logger)      │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│  CLI/Server Layer                       │
│  1. Import core                         │
│  2. Register custom providers           │
│  3. Load config YAML                    │
│  4. createBlobStore validates & creates │
└─────────────────────────────────────────┘
```

## Built-in Providers

### Local Filesystem
```yaml
storage:
  blob:
    type: local
    storePath: /path/to/blobs
    maxBlobSize: 52428800  # 50MB
    cleanupAfterDays: 30
```

### In-Memory
```yaml
storage:
  blob:
    type: in-memory
    maxBlobSize: 10485760  # 10MB
    maxTotalSize: 104857600  # 100MB
```

## Creating Custom Providers

### 1. Define Provider Type and Config

```typescript
// packages/cli/src/storage/s3-provider.ts
import type { BlobStoreProvider, BlobStore } from '@dexto/core';
import { z } from 'zod';

// Define config interface
interface S3BlobStoreConfig {
  type: 's3';
  bucket: string;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

// Create Zod schema
const S3BlobStoreSchema = z.object({
  type: z.literal('s3'),
  bucket: z.string(),
  region: z.string(),
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional(),
}).strict();
```

### 2. Implement BlobStore Interface

```typescript
// packages/cli/src/storage/s3-blob-store.ts
import { S3Client } from '@aws-sdk/client-s3';
import type { BlobStore, BlobInput, BlobMetadata, BlobReference, BlobData, BlobStats } from '@dexto/core';

export class S3BlobStore implements BlobStore {
  private client: S3Client;
  private config: S3BlobStoreConfig;

  constructor(config: S3BlobStoreConfig, logger: IDextoLogger) {
    this.config = config;
    this.client = new S3Client({ region: config.region });
  }

  async connect(): Promise<void> {
    // Initialize S3 client
  }

  async store(input: BlobInput, metadata?: BlobMetadata): Promise<BlobReference> {
    // Upload to S3
  }

  async retrieve(reference: string, format?: string): Promise<BlobData> {
    // Download from S3
  }

  // ... implement other BlobStore methods
}
```

### 3. Create Provider Definition

```typescript
// packages/cli/src/storage/s3-provider.ts (continued)
import { S3BlobStore } from './s3-blob-store.js';

export const s3BlobStoreProvider: BlobStoreProvider<'s3', S3BlobStoreConfig> = {
  type: 's3',
  configSchema: S3BlobStoreSchema,
  create: (config, logger) => new S3BlobStore(config, logger),
  metadata: {
    displayName: 'Amazon S3',
    description: 'Store blobs in AWS S3',
    requiresNetwork: true,
  },
};
```

### 4. Register Provider at CLI Layer

```typescript
// packages/cli/src/index.ts
import { blobStoreRegistry } from '@dexto/core';
import { s3BlobStoreProvider } from './storage/s3-provider.js';

// Register BEFORE loading config
blobStoreRegistry.register(s3BlobStoreProvider);

// Now S3 is available in config
const config = loadAgentConfig();
const blobStore = createBlobStore(config.storage.blob, logger);
```

### 5. Use in Configuration

```yaml
# agents/my-agent.yml
storage:
  blob:
    type: s3  # Custom provider now available!
    bucket: my-bucket
    region: us-east-1
```

## Type Safety

The provider pattern ensures compile-time and runtime type safety:

### Compile-Time Safety
```typescript
// ✅ Type-safe: TypeScript enforces 's3' matches config type
const s3Provider: BlobStoreProvider<'s3', S3BlobStoreConfig> = {
  type: 's3',  // Must be 's3'
  configSchema: S3BlobStoreSchema,  // Must output S3BlobStoreConfig
  create: (config, logger) => {
    // config is properly typed as S3BlobStoreConfig
    return new S3BlobStore(config, logger);
  },
};

// ❌ Compile error: type mismatch
const badProvider: BlobStoreProvider<'s3', S3BlobStoreConfig> = {
  type: 'azure',  // ERROR: Type '"azure"' is not assignable to type '"s3"'
  // ...
};
```

### Runtime Validation
```typescript
// Factory validates config against provider schema
const blobStore = createBlobStore(
  { type: 's3', bucket: 'my-bucket', region: 'us-east-1' },
  logger
);

// If validation fails, Zod throws with detailed error:
// "bucket" is required, "region" must be a string, etc.
```

## Benefits

### ✅ Extensibility
- Add new providers without modifying core
- Register providers at any layer (CLI, server, tests)
- Multiple apps can have different provider sets

### ✅ Type Safety
- Compile-time verification of provider definitions
- Runtime validation via Zod schemas
- Full autocomplete support

### ✅ Separation of Concerns
- Core stays lightweight (no cloud SDKs)
- Cloud-specific code in appropriate layers
- Optional dependencies only when needed

### ✅ Configuration-Driven
- YAML config selects the provider
- No code changes to switch backends
- Environment-specific configurations

### ✅ Testability
- Register mock providers in tests
- Isolated unit testing per provider
- Registry can be cleared between tests

## Implementation Details

### Provider Interface
```typescript
export interface BlobStoreProvider<
  TType extends string,
  TConfig extends { type: TType }
> {
  type: TType;
  configSchema: z.ZodType<TConfig>;
  create(config: TConfig, logger: IDextoLogger): BlobStore;
  metadata?: {
    displayName: string;
    description: string;
    requiresNetwork?: boolean;
  };
}
```

### Registry
- Global singleton: `blobStoreRegistry`
- Thread-safe registration
- Validates configs at runtime
- Provides error messages with available types

### Factory
```typescript
export function createBlobStore(
  config: { type: string; [key: string]: any },
  logger: IDextoLogger
): BlobStore {
  // 1. Validate config against provider schema
  const validatedConfig = blobStoreRegistry.validateConfig(config);

  // 2. Get provider
  const provider = blobStoreRegistry.get(validatedConfig.type);

  // 3. Create instance
  return provider.create(validatedConfig, logger);
}
```

## Migration Guide

### From Hardcoded Switch Statements

**Before:**
```typescript
export function createBlobStore(config: BlobStoreConfig, logger: IDextoLogger): BlobStore {
  switch (config.type) {
    case 'local':
      return new LocalBlobStore(config, logger);
    case 's3':
      return new S3BlobStore(config, logger);
    default:
      throw new Error(`Unknown type: ${config.type}`);
  }
}
```

**After:**
```typescript
// Core provides registry
export function createBlobStore(config, logger): BlobStore {
  return blobStoreRegistry.validateConfig(config);
  return blobStoreRegistry.get(config.type).create(config, logger);
}

// CLI registers custom providers
blobStoreRegistry.register(s3Provider);
```

**Benefits:**
- ✅ No more modifying factory for new providers
- ✅ Providers can live in different packages
- ✅ Type safety maintained
- ✅ Config validation per provider

## Example: Supabase Provider

The Supabase provider demonstrates the pattern:

**Location:** `packages/cli/src/storage/supabase-provider.ts`

```typescript
export const supabaseBlobStoreProvider: BlobStoreProvider<
  'supabase',
  SupabaseBlobStoreConfig
> = {
  type: 'supabase',
  configSchema: SupabaseBlobStoreSchema,
  create: (config, logger) => new SupabaseBlobStore(config, logger),
  metadata: {
    displayName: 'Supabase Storage',
    description: 'Store blobs in Supabase cloud storage',
    requiresNetwork: true,
  },
};
```

**Registration:** `packages/cli/src/index.ts`
```typescript
import { blobStoreRegistry } from '@dexto/core';
import { supabaseBlobStoreProvider } from './storage/supabase-provider.js';

blobStoreRegistry.register(supabaseBlobStoreProvider);
```

**Usage in config:**
```yaml
storage:
  blob:
    type: supabase
    supabaseUrl: https://xxx.supabase.co
    supabaseKey: your-key
    bucket: dexto-blobs
```

## Testing

### Register Mock Provider
```typescript
import { blobStoreRegistry, type BlobStoreProvider } from '@dexto/core';

const mockProvider: BlobStoreProvider<'mock', MockConfig> = {
  type: 'mock',
  configSchema: MockConfigSchema,
  create: (config, logger) => new MockBlobStore(config, logger),
};

beforeEach(() => {
  blobStoreRegistry.register(mockProvider);
});

afterEach(() => {
  blobStoreRegistry.unregister('mock');
});
```

### Test Provider Registration
```typescript
test('provider registration', () => {
  blobStoreRegistry.register(s3Provider);

  expect(blobStoreRegistry.has('s3')).toBe(true);
  expect(blobStoreRegistry.getTypes()).toContain('s3');
});
```

### Test Config Validation
```typescript
test('validates config against provider schema', () => {
  blobStoreRegistry.register(s3Provider);

  expect(() => {
    blobStoreRegistry.validateConfig({ type: 's3' }); // missing required fields
  }).toThrow(); // Zod validation error
});
```

## Future Enhancements

- [ ] Provider discovery API for CLI help/docs
- [ ] Provider health checks
- [ ] Provider migration utilities
- [ ] Auto-registration via package.json conventions
- [ ] Provider dependency injection for testing
