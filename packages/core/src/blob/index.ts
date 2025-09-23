/**
 * Blob Service - Infrastructure-level blob storage with pluggable backends
 *
 * Provides unified blob storage capabilities supporting multiple backends:
 * - Local filesystem (default)
 * - Amazon S3 (coming soon)
 * - Google Cloud Storage (coming soon)
 * - Azure Blob Storage (coming soon)
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
    BlobBackendConfig,
    BlobServiceConfig,
    LocalBlobBackendConfig,
    S3BlobBackendConfig,
    GCSBlobBackendConfig,
    AzureBlobBackendConfig,
} from './types.js';

// Error handling
export { BlobError } from './errors.js';
export { BlobErrorCode } from './error-codes.js';
