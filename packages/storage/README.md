# `@dexto/storage`

Concrete storage backend implementations (blob store, database, cache) and their config schemas.

Core (`@dexto/core`) owns typed domain store contracts such as `ConversationStore`,
`SessionStore`, `MemoryStore`, `ArtifactStore`, and `ToolStateStore`. This package provides Node
backend implementations (`BlobStore`, `Database`, `Cache`) that image implementations can use
internally to compose a `DextoStores` implementation.

Product layers (CLI/server/apps) can either use these helpers inside an image or provide a
native `DextoStores` implementation directly.

## What this package exports

- **Schemas** (for config parsing + UI):
  - Import from `@dexto/storage/schemas` for browser-safe schema-only exports.
- **Concrete implementations** (Node runtime):
  - `LocalBlobStore`, `MemoryBlobStore`, `SQLiteStore`, `PostgresStore`, `RedisStore`, etc.

## Using helpers in an image

```ts
import type { DextoImage } from '@dexto/agent-config';
import { BackendDextoStores } from '@dexto/core/storage';
import {
  StorageSchema,
  LocalBlobStore,
  LocalBlobStoreSchema,
  SQLiteStore,
  SqliteDatabaseSchema,
  MemoryCacheStore,
} from '@dexto/storage';

export const myImage: DextoImage = {
  /* metadata/defaults/tools/hooks/compaction/logger ... */
  storage: {
    configSchema: StorageSchema,
    async createStores(config, logger) {
      const blobStore = new LocalBlobStore(LocalBlobStoreSchema.parse(config.blob), logger);
      const database = new SQLiteStore(SqliteDatabaseSchema.parse(config.database), logger);
      const cache = new MemoryCacheStore();
      return new BackendDextoStores({ blobStore, database, cache }, logger);
    },
  },
};
```

## Schemas and `.passthrough()`

Agent config parsing needs to accept **custom** backends with provider-specific fields, so the
top-level storage config schemas are *envelopes* that validate only the discriminator:

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
```

Those envelope schemas use `.passthrough()` so extra fields survive initial parsing. Detailed
validation happens later inside the loaded image's `storage.createStores(...)` implementation.
