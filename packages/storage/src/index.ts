/**
 * @dexto/storage
 *
 * Concrete storage backends + config schemas + factory objects.
 *
 * Core keeps only the storage *interfaces* (`BlobStore`, `Database`, `Cache`) and `StorageManager`.
 * Product layers (CLI/server/platform) choose which factories to include via images.
 */

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
    InMemoryBlobStoreConfigInput,
    InMemoryBlobStoreConfig,
    LocalBlobStoreConfigInput,
    LocalBlobStoreConfig,
} from './schemas.js';

export type { CacheFactory } from './cache/index.js';
export { inMemoryCacheFactory, redisCacheFactory } from './cache/factories/index.js';
export { MemoryCacheStore } from './cache/memory-cache-store.js';
export { RedisStore } from './cache/redis-store.js';

export type { DatabaseFactory } from './database/index.js';
export {
    inMemoryDatabaseFactory,
    sqliteDatabaseFactory,
    postgresDatabaseFactory,
} from './database/factories/index.js';
export { MemoryDatabaseStore } from './database/memory-database-store.js';
export { SQLiteStore } from './database/sqlite-store.js';
export { PostgresStore } from './database/postgres-store.js';

export type { BlobStoreFactory } from './blob/index.js';
export { localBlobStoreFactory, inMemoryBlobStoreFactory } from './blob/factories/index.js';
export { LocalBlobStore } from './blob/local-blob-store.js';
export { InMemoryBlobStore } from './blob/memory-blob-store.js';
