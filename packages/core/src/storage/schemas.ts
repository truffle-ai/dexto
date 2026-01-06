import { z } from 'zod';

// Re-export all cache schemas and types
export {
    CACHE_TYPES,
    CacheConfigSchema,
    type CacheType,
    type CacheConfig,
    type InMemoryCacheConfig,
    type RedisCacheConfig,
} from './cache/schemas.js';

// Re-export all database schemas and types
export {
    DATABASE_TYPES,
    DatabaseConfigSchema,
    type DatabaseType,
    type DatabaseConfig,
    type InMemoryDatabaseConfig,
    type SqliteDatabaseConfig,
    type PostgresDatabaseConfig,
} from './database/schemas.js';

// Re-export all blob schemas and types
export {
    BLOB_STORE_TYPES,
    BlobStoreConfigSchema,
    InMemoryBlobStoreSchema,
    LocalBlobStoreSchema,
    type BlobStoreType,
    type BlobStoreConfig,
    type InMemoryBlobStoreConfig,
    type LocalBlobStoreConfig,
} from './blob/schemas.js';

// Import for composition
import { CacheConfigSchema } from './cache/schemas.js';
import { DatabaseConfigSchema } from './database/schemas.js';
import { BlobStoreConfigSchema } from './blob/schemas.js';

/**
 * Top-level storage configuration schema
 * Composes cache, database, and blob store configurations
 *
 * Note: Blob config uses runtime validation via the provider registry,
 * allowing custom providers to be registered at the CLI/server layer.
 */
export const StorageSchema = z
    .object({
        cache: CacheConfigSchema.describe('Cache configuration (fast, ephemeral)'),
        database: DatabaseConfigSchema.describe('Database configuration (persistent, reliable)'),
        blob: BlobStoreConfigSchema.describe(
            'Blob store configuration (for large, unstructured data)'
        ),
    })
    .strict()
    .describe('Storage configuration with cache, database, and blob store')
    .brand<'ValidatedStorageConfig'>();

export type StorageConfig = z.input<typeof StorageSchema>;
export type ValidatedStorageConfig = z.output<typeof StorageSchema>;
