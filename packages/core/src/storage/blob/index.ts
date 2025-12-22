/**
 * Blob Storage Module
 *
 * This module provides a flexible blob storage system with support for
 * multiple backends through a provider pattern.
 *
 * ## Built-in Providers
 * - `local`: Store blobs on the local filesystem
 * - `in-memory`: Store blobs in RAM (for testing/development)
 *
 * ## Custom Providers
 * Custom providers (e.g., S3, Azure, Supabase) can be registered at the
 * CLI/server layer before configuration loading.
 *
 * ## Usage
 *
 * ### Using built-in providers
 * ```typescript
 * import { createBlobStore } from '@dexto/core';
 *
 * const blob = createBlobStore({ type: 'local', storePath: '/tmp' }, logger);
 * ```
 *
 * ### Registering custom providers
 * ```typescript
 * import { blobStoreRegistry, type BlobStoreProvider } from '@dexto/core';
 *
 * const s3Provider: BlobStoreProvider<'s3', S3Config> = {
 *   type: 's3',
 *   configSchema: S3ConfigSchema,
 *   create: (config, logger) => new S3BlobStore(config, logger),
 * };
 *
 * blobStoreRegistry.register(s3Provider);
 * const blob = createBlobStore({ type: 's3', bucket: 'my-bucket' }, logger);
 * ```
 */

// Import built-in providers
import { blobStoreRegistry } from './registry.js';
import { localBlobStoreProvider, inMemoryBlobStoreProvider } from './providers/index.js';

// Register built-in providers on module load
// This ensures they're available when importing from @dexto/core
// Guard against duplicate registration when module is imported multiple times
if (!blobStoreRegistry.has('local')) {
    blobStoreRegistry.register(localBlobStoreProvider);
}
if (!blobStoreRegistry.has('in-memory')) {
    blobStoreRegistry.register(inMemoryBlobStoreProvider);
}

// Export public API
export { createBlobStore } from './factory.js';
export { blobStoreRegistry, BlobStoreRegistry } from './registry.js';
export type { BlobStoreProvider } from './provider.js';

// Export types and interfaces
export type {
    BlobStore,
    BlobInput,
    BlobMetadata,
    BlobReference,
    BlobData,
    BlobStats,
    StoredBlobMetadata,
} from './types.js';

// Export schemas and config types
export {
    BLOB_STORE_TYPES,
    BlobStoreConfigSchema,
    InMemoryBlobStoreSchema,
    LocalBlobStoreSchema,
    type BlobStoreType,
    type BlobStoreConfig,
    type InMemoryBlobStoreConfig,
    type LocalBlobStoreConfig,
} from './schemas.js';

// Export concrete implementations (for custom usage and external providers)
export { LocalBlobStore } from './local-blob-store.js';
export { InMemoryBlobStore } from './memory-blob-store.js';
