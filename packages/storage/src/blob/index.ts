/**
 * Blob Storage Module
 *
 * This module provides a flexible blob storage system with support for
 * multiple backends through a factory pattern.
 *
 * ## Built-in Factories
 * - `local`: Store blobs on the local filesystem
 * - `in-memory`: Store blobs in RAM (for testing/development)
 *
 * ## Custom Factories
 * Image implementations decide which factories to use inside their `storage.createStores`
 * implementation.
 *
 * ## Usage
 * Blob stores are typically constructed by an image's storage implementation. For direct usage,
 * call a factory's `create()` after validating config with its `configSchema`.
 */

// Export public API
export type { BlobStoreFactory } from './factory.js';

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

// Export built-in factories (plain exports; no registries)
export { localBlobStoreFactory, inMemoryBlobStoreFactory } from './factories/index.js';

// Export schemas and config types
export {
    BLOB_STORE_TYPES,
    BlobStoreConfigSchema,
    InMemoryBlobStoreSchema,
    LocalBlobStoreSchema,
    type BlobStoreType,
    type BlobStoreConfig,
    type InMemoryBlobStoreConfigInput,
    type InMemoryBlobStoreConfig,
    type LocalBlobStoreConfigInput,
    type LocalBlobStoreConfig,
} from './schemas.js';

// Export concrete implementations (for custom usage and external providers)
export { LocalBlobStore } from './local-blob-store.js';
export { MemoryBlobStore } from './memory-blob-store.js';
