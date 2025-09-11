import type { CacheBackend } from './cache-backend.js';
import type { DatabaseBackend } from './database-backend.js';

// Re-export interfaces
export type { CacheBackend, DatabaseBackend };

// Re-export schema types for convenience
export type {
    BackendConfig,
    StorageConfig,
    ValidatedStorageConfig,
    InMemoryBackendConfig,
    RedisBackendConfig,
    SqliteBackendConfig,
    PostgresBackendConfig,
} from '../schemas.js';

/**
 * Collection of storage backends for different use cases
 */
export interface StorageBackends {
    cache: CacheBackend; // Fast, ephemeral (Redis, Memory)
    database: DatabaseBackend; // Persistent, reliable (PostgreSQL, SQLite, Memory)
}
