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
 * During the DI refactor, custom providers are resolved by product layers (CLI/server/platform)
 * via typed image factories (`@dexto/agent-config`), not via core registries.
 *
 * ## Usage
 * Blob stores are typically constructed by the product-layer resolver (`@dexto/agent-config`)
 * via image-provided factory maps. For direct usage, call a provider's `create()` after validating
 * config with its `configSchema`.
 */

// Export public API
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

// Export built-in providers (plain exports; no auto-registration)
export { localBlobStoreProvider, inMemoryBlobStoreProvider } from './providers/index.js';

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
