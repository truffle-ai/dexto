/**
 * Dexto Storage Layer
 *
 * A storage system with two backend types:
 * - CacheBackend: Fast, ephemeral storage (Redis, Memory) with TTL support
 * - DatabaseBackend: Persistent, reliable storage (PostgreSQL, SQLite, Memory) with list operations
 *
 * Usage:
 *
 * ```typescript
 * // Create storage backends for an agent instance
 * const { manager, backends } = await createStorageBackends({
 *   cache: { type: 'in-memory' },
 *   database: { type: 'in-memory' }
 * });
 *
 * // Use cache for temporary data
 * await backends.cache.set('session:123', sessionData, 3600); // 1 hour TTL
 * const sessionData = await backends.cache.get('session:123');
 *
 * // Use database for persistent data
 * await backends.database.set('user:456', userData);
 * await backends.database.append('messages:789', message);
 * const messages = await backends.database.getRange('messages:789', 0, 50);
 *
 * // Cleanup when done
 * await manager.disconnect();
 * ```
 */

// Main storage manager and utilities
export { StorageManager, createStorageBackends } from './storage-manager.js';

// Backend interfaces
export type {
    CacheBackend,
    DatabaseBackend,
    StorageBackends,
    BackendConfig,
    StorageConfig,
    ValidatedStorageConfig,
} from './backend/types.js';

// Backend implementations - always available
export { MemoryBackend } from './backend/memory-backend.js';

// Note: Backend configuration types (RedisBackendConfig, PostgresBackendConfig, etc.)
// are exported from './config/schemas.js' to maintain single source of truth
// Note: Actual backend classes are lazy-loaded by StorageManager to handle optional dependencies
