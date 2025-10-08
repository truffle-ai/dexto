/**
 * Blob Service - Infrastructure-level blob storage
 *
 * Provides blob storage capabilities using the local filesystem backend.
 */

// Core service
export { BlobService, createBlobService } from './blob-service.js';

// Backends
export { LocalBlobBackend } from './backend/local-backend.js';

// Types
export type {
    BlobService as IBlobService,
    BlobBackend,
    BlobInput,
    BlobMetadata,
    StoredBlobMetadata,
    BlobReference,
    BlobData,
    BlobStats,
    BlobServiceConfig,
} from './types.js';

// Schema types
export type { ValidatedBlobServiceConfig } from './schemas.js';

// Error handling
export { BlobError } from './errors.js';
export { BlobErrorCode } from './error-codes.js';
