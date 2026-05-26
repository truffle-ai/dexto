/**
 * @dexto/storage
 *
 * Concrete storage backends + config schemas.
 *
 * Core keeps typed domain store contracts. This package provides backend implementations that
 * image/config resolution can compose into `DextoStores`.
 */

export type { StorageConfig, ValidatedStorageConfig } from './schemas.js';
export {
    StorageSchema,
    CACHE_TYPES,
    DATABASE_TYPES,
    BLOB_STORE_TYPES,
    CacheConfigSchema,
    InMemoryCacheSchema,
    RedisCacheSchema,
    DatabaseConfigSchema,
    InMemoryDatabaseSchema,
    SqliteDatabaseSchema,
    PostgresDatabaseSchema,
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
    InMemoryBlobStoreConfigInput,
    InMemoryBlobStoreConfig,
    LocalBlobStoreConfigInput,
    LocalBlobStoreConfig,
} from './schemas.js';

export { MemoryCacheStore } from './cache/memory-cache-store.js';
export { RedisStore } from './cache/redis-store.js';

export { MemoryDatabaseStore } from './database/memory-database-store.js';
export { SQLiteStore } from './database/sqlite-store.js';
export { PostgresStore } from './database/postgres-store.js';

export { LocalBlobStore } from './blob/local-blob-store.js';
export { MemoryBlobStore } from './blob/memory-blob-store.js';
