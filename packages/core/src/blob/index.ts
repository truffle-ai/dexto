/**
 * Blob Infrastructure - Types, schemas, and utilities
 *
 * This module provides core blob infrastructure used by the storage module.
 * For blob storage operations, use StorageManager.getBlobStore() instead.
 *
 * Note: BlobService has been replaced by BlobStore which is integrated
 * into the storage module. This module now only exports shared types,
 * schemas, and error handling utilities.
 */

// Backends (used internally by storage module)
export { LocalBlobBackend } from './backend/local-backend.js';

// Types
export type {
    BlobBackend,
    BlobInput,
    BlobMetadata,
    StoredBlobMetadata,
    BlobReference,
    BlobData,
    BlobStats,
} from './types.js';

// Schema types
export type { ValidatedBlobServiceConfig } from './schemas.js';
export { BlobServiceConfigSchema } from './schemas.js';

// Error handling
export { BlobError } from './errors.js';
export { BlobErrorCode } from './error-codes.js';
