/**
 * @dexto/storage
 *
 * Concrete storage backends + config schemas + factories.
 *
 * Core keeps only the storage *interfaces* (`BlobStore`, `Database`, `Cache`) and `StorageManager`.
 * Product layers (CLI/server/platform) choose which factories to include via images.
 */

export { createStorageManager } from './storage-manager.js';

export type { StorageConfig, ValidatedStorageConfig } from './schemas.js';
export {
    StorageSchema,
    CACHE_TYPES,
    DATABASE_TYPES,
    BLOB_STORE_TYPES,
    CacheConfigSchema,
    DatabaseConfigSchema,
    BlobStoreConfigSchema,
    InMemoryBlobStoreSchema,
    LocalBlobStoreSchema,
} from './schemas.js';
export type {
    CacheType,
    DatabaseType,
    BlobStoreType,
    CacheConfig,
    InMemoryCacheConfig,
    RedisCacheConfig,
    DatabaseConfig,
    InMemoryDatabaseConfig,
    SqliteDatabaseConfig,
    PostgresDatabaseConfig,
    BlobStoreConfig,
    InMemoryBlobStoreConfig,
    LocalBlobStoreConfig,
} from './schemas.js';

export { createCache } from './cache/index.js';
export type { CacheProvider } from './cache/index.js';
export { inMemoryCacheProvider, redisCacheProvider } from './cache/providers/index.js';
export { MemoryCacheStore } from './cache/memory-cache-store.js';
export { RedisStore } from './cache/redis-store.js';

export { createDatabase } from './database/index.js';
export type { DatabaseProvider } from './database/index.js';
export {
    inMemoryDatabaseProvider,
    sqliteDatabaseProvider,
    postgresDatabaseProvider,
} from './database/providers/index.js';
export { MemoryDatabaseStore } from './database/memory-database-store.js';
export { SQLiteStore } from './database/sqlite-store.js';
export { PostgresStore } from './database/postgres-store.js';

export { createBlobStore } from './blob/index.js';
export type { BlobStoreProvider } from './blob/index.js';
export { localBlobStoreProvider, inMemoryBlobStoreProvider } from './blob/providers/index.js';
export { LocalBlobStore } from './blob/local-blob-store.js';
export { InMemoryBlobStore } from './blob/memory-blob-store.js';

// Factory aliases (configSchema + create) for image usage (Phase 3.5).
export {
    localBlobStoreProvider as localBlobStoreFactory,
    inMemoryBlobStoreProvider as inMemoryBlobStoreFactory,
} from './blob/providers/index.js';
export {
    sqliteDatabaseProvider as sqliteFactory,
    postgresDatabaseProvider as postgresFactory,
    inMemoryDatabaseProvider as inMemoryDatabaseFactory,
} from './database/providers/index.js';
export {
    inMemoryCacheProvider as inMemoryCacheFactory,
    redisCacheProvider as redisCacheFactory,
} from './cache/providers/index.js';
