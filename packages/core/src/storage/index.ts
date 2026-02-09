/**
 * Dexto Storage Layer
 *
 * A storage system with three storage types:
 * - Cache: Fast, ephemeral storage (Redis, Memory) with TTL support
 * - Database: Persistent, reliable storage (PostgreSQL, SQLite, Memory) with list operations
 * - Blob: Large object storage (Local, Memory) for files and binary data
 *
 * All storage types use a provider pattern for extensibility.
 *
 * Usage:
 *
 * ```typescript
 * // Create and initialize a storage manager
 * const manager = await createStorageManager({
 *   cache: { type: 'in-memory' },
 *   database: { type: 'in-memory' },
 *   blob: { type: 'local', storePath: '/tmp/blobs' }
 * });
 *
 * // Access cache and database via getters
 * const cache = manager.getCache();
 * const database = manager.getDatabase();
 * const blobStore = manager.getBlobStore();
 *
 * // Use cache for temporary data
 * await cache.set('session:123', sessionData, 3600); // 1 hour TTL
 * const sessionData = await cache.get('session:123');
 *
 * // Use database for persistent data
 * await database.set('user:456', userData);
 * await database.append('messages:789', message);
 * const messages = await database.getRange('messages:789', 0, 50);
 *
 * // Cleanup when done
 * await manager.disconnect();
 * ```
 *
 * ## Registering Custom Providers
 *
 * ```typescript
 * import { databaseRegistry, cacheRegistry } from '@dexto/core';
 *
 * // Register before loading config
 * databaseRegistry.register(mongoProvider);
 * cacheRegistry.register(memcachedProvider);
 * // Blob providers are resolved by product layers via images during the DI refactor.
 * ```
 */

// Main storage manager and utilities
export { StorageManager, createStorageManager } from './storage-manager.js';

export type { StorageConfig, ValidatedStorageConfig } from './schemas.js';

export { CACHE_TYPES, DATABASE_TYPES, BLOB_STORE_TYPES } from './schemas.js';
export type { CacheType, DatabaseType, BlobStoreType } from './schemas.js';
export {
    CacheConfigSchema,
    DatabaseConfigSchema,
    BlobStoreConfigSchema,
    StorageSchema,
} from './schemas.js';

export { createDatabase, databaseRegistry, DatabaseRegistry } from './database/index.js';
export type { DatabaseProvider } from './database/index.js';

export type { Database } from './database/types.js';

export {
    inMemoryDatabaseProvider,
    sqliteDatabaseProvider,
    postgresDatabaseProvider,
} from './database/providers/index.js';

export type {
    DatabaseConfig,
    InMemoryDatabaseConfig,
    SqliteDatabaseConfig,
    PostgresDatabaseConfig,
} from './schemas.js';

export { MemoryDatabaseStore } from './database/memory-database-store.js';

export { createCache, cacheRegistry, CacheRegistry } from './cache/index.js';
export type { CacheProvider } from './cache/index.js';

export type { Cache } from './cache/types.js';

export { inMemoryCacheProvider, redisCacheProvider } from './cache/providers/index.js';

export type { CacheConfig, InMemoryCacheConfig, RedisCacheConfig } from './schemas.js';

export { MemoryCacheStore } from './cache/memory-cache-store.js';

export { createBlobStore } from './blob/index.js';
export type { BlobStoreProvider } from './blob/index.js';

export type { BlobStore } from './blob/types.js';
export type {
    BlobInput,
    BlobMetadata,
    StoredBlobMetadata,
    BlobReference,
    BlobData,
    BlobStats,
} from './blob/types.js';

export { localBlobStoreProvider, inMemoryBlobStoreProvider } from './blob/providers/index.js';

export type { BlobStoreConfig, InMemoryBlobStoreConfig, LocalBlobStoreConfig } from './schemas.js';

export { LocalBlobStore, InMemoryBlobStore } from './blob/index.js';
