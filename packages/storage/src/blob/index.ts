/**
 * Blob Storage Module
 *
 * This module provides a flexible blob storage system with support for
 * multiple concrete backends.
 *
 * ## Usage
 * Blob stores are typically constructed by an image's storage implementation after validating
 * config with the matching schema.
 */

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
    type InMemoryBlobStoreConfigInput,
    type InMemoryBlobStoreConfig,
    type LocalBlobStoreConfigInput,
    type LocalBlobStoreConfig,
} from './schemas.js';

// Export concrete implementations (for custom usage and external providers)
export { LocalBlobStore } from './local-blob-store.js';
export { MemoryBlobStore } from './memory-blob-store.js';
