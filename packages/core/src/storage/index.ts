/**
 * Dexto Storage Layer
 *
 * A storage system with two storage types:
 * - Cache: Fast, ephemeral storage (Redis, Memory) with TTL support
 * - Database: Persistent, reliable storage (PostgreSQL, SQLite, Memory) with list operations
 *
 * Usage:
 *
 * ```typescript
 * // Create and initialize a storage manager
 * const manager = await createStorageManager({
 *   cache: { type: 'in-memory' },
 *   database: { type: 'in-memory' }
 * });
 *
 * // Access cache and database via getters
 * const cache = manager.getCache();
 * const database = manager.getDatabase();
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
 */

// Main storage manager and utilities
export { StorageManager, createStorageManager } from './storage-manager.js';

// Storage interfaces
export type { Cache } from './cache/types.js';
export type { Database } from './database/types.js';

// Schema types
export type { StorageConfig, ValidatedStorageConfig } from './schemas.js';

// Store implementations - always available
export { MemoryCacheStore } from './cache/memory-cache-store.js';
export { MemoryDatabaseStore } from './database/memory-database-store.js';

// Schema constants, types, and schemas for UI consumption
export { CACHE_TYPES, DATABASE_TYPES, BLOB_STORE_TYPES } from './schemas.js';
export type { CacheType, DatabaseType, BlobStoreType } from './schemas.js';
export {
    CacheConfigSchema,
    DatabaseConfigSchema,
    BlobStoreConfigSchema,
    StorageSchema,
} from './schemas.js';

// Blob storage interface and types
export type { BlobStore } from './blob/types.js';
export type {
    BlobInput,
    BlobMetadata,
    StoredBlobMetadata,
    BlobReference,
    BlobData,
    BlobStats,
} from './blob/types.js';

// Blob storage config types
export type { BlobStoreConfig, InMemoryBlobStoreConfig, LocalBlobStoreConfig } from './schemas.js';

// Cache config types
export type { CacheConfig, InMemoryCacheConfig, RedisCacheConfig } from './schemas.js';

// Database config types
export type {
    DatabaseConfig,
    InMemoryDatabaseConfig,
    SqliteDatabaseConfig,
    PostgresDatabaseConfig,
} from './schemas.js';

// Note: Actual backend classes are lazy-loaded by StorageManager to handle optional dependencies
