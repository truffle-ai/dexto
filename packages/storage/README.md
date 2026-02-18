# `@dexto/storage`

Concrete storage backends (blob store, database, cache) and their config schemas/factories.

Core (`@dexto/core`) owns the **interfaces** (`BlobStore`, `Database`, `Cache`) and `StorageManager`.
Product layers (CLI/server/apps) choose which concrete backends are available by including factories
in an image (`DextoImage.storage.*`) and resolving config via `@dexto/agent-config`.

## What this package exports

- **Factories** (for image modules):
  - Blob: `localBlobStoreFactory`, `inMemoryBlobStoreFactory`
  - Database: `sqliteDatabaseFactory`, `postgresDatabaseFactory`, `inMemoryDatabaseFactory`
  - Cache: `inMemoryCacheFactory`, `redisCacheFactory`
- **Schemas** (for config parsing + UI):
  - Import from `@dexto/storage/schemas` for browser-safe schema-only exports.
- **Concrete implementations** (Node runtime):
  - `LocalBlobStore`, `MemoryBlobStore`, `SQLiteStore`, `PostgresStore`, `RedisStore`, etc.

## Using factories in an image

```ts
import type { DextoImage } from '@dexto/agent-config';
import {
  localBlobStoreFactory,
  sqliteDatabaseFactory,
  inMemoryCacheFactory,
} from '@dexto/storage';

export const myImage: DextoImage = {
  /* metadata/defaults/tools/hooks/compaction/logger ... */
  storage: {
    blob: { local: localBlobStoreFactory },
    database: { sqlite: sqliteDatabaseFactory },
    cache: { 'in-memory': inMemoryCacheFactory },
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
validation happens later in `@dexto/agent-config` by selecting the right factory from the loaded
image and validating against that factory’s `configSchema`.

## Optional dependencies

Some backends rely on optional peer dependencies:

- SQLite: `better-sqlite3`
- Postgres: `pg`
- Redis: `ioredis`

Factories load these lazily and throw an actionable error if the dependency is missing.

## Browser safety

If you only need schemas/types (e.g., WebUI), import from:

```ts
import { StorageSchema } from '@dexto/storage/schemas';
```

Do not import from `@dexto/storage` in browser bundles, since the root entry also exports Node
implementations.
