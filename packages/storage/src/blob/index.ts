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
 * Product layers (CLI/server/platform) decide which factories are available by including them
 * in images (`DextoImageModule.storage.blob`).
 *
 * ## Usage
 * Blob stores are typically constructed by the product-layer resolver (`@dexto/agent-config`)
 * via image-provided factory maps. For direct usage, call a factory's `create()` after validating
 * config with its `configSchema`.
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
    type InMemoryBlobStoreConfig,
    type LocalBlobStoreConfig,
} from './schemas.js';

// Export concrete implementations (for custom usage and external providers)
export { LocalBlobStore } from './local-blob-store.js';
export { InMemoryBlobStore } from './memory-blob-store.js';
