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
export type { Cache } from './cache/cache.js';
export type { Database } from './database/database.js';

// Schema types
export type { BackendConfig, StorageConfig, ValidatedStorageConfig } from './schemas.js';

// Store implementations - always available
export { MemoryCacheStore } from './cache/memory-cache-store.js';
export { MemoryDatabaseStore } from './database/memory-database-store.js';

// Schema constants, types, and schemas for UI consumption
export { CACHE_BACKEND_TYPES, DATABASE_BACKEND_TYPES } from './schemas.js';
export type { CacheBackendType, DatabaseBackendType } from './schemas.js';
export { BackendConfigSchema, StorageSchema } from './schemas.js';

// Blob storage interface and types
export type { BlobStore } from './blob/blob-store.js';
export type {
    BlobInput,
    BlobMetadata,
    StoredBlobMetadata,
    BlobReference,
    BlobData,
    BlobStats,
} from './blob/types.js';

// Blob storage schemas and config
export { BlobServiceConfigSchema } from './blob/schemas.js';
export type { ValidatedBlobServiceConfig } from './blob/schemas.js';

// Note: Backend configuration types (RedisBackendConfig, PostgresBackendConfig, etc.)
// are exported from './config/schemas.js' to maintain single source of truth
// Note: Actual backend classes are lazy-loaded by StorageManager to handle optional dependencies
