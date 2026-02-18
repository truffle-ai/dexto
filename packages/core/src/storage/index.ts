/**
 * @dexto/core storage surface
 *
 * Core exposes only:
 * - storage interfaces (`BlobStore`, `Database`, `Cache`)
 * - the `StorageManager` lifecycle wrapper
 * - storage error types/codes
 *
 * Concrete implementations + config schemas live in `@dexto/storage`.
 */

export { StorageManager } from './storage-manager.js';
export type { StorageBackends } from './storage-manager.js';

export { StorageError } from './errors.js';
export { StorageErrorCode } from './error-codes.js';

export type { Cache } from './cache/types.js';
export type { Database } from './database/types.js';
export type { BlobStore } from './blob/types.js';
export type {
    BlobInput,
    BlobMetadata,
    StoredBlobMetadata,
    BlobReference,
    BlobData,
    BlobStats,
} from './blob/types.js';
