/**
 * Storage-specific error codes
 * Includes cache, database, and blob storage errors
 */
export enum StorageErrorCode {
    // Connection
    CONNECTION_FAILED = 'storage_connection_failed',
    CONNECTION_CONFIG_MISSING = 'storage_connection_config_missing',

    // Operations
    READ_FAILED = 'storage_read_failed',
    WRITE_FAILED = 'storage_write_failed',
    DELETE_FAILED = 'storage_delete_failed',

    // Database specific
    MIGRATION_FAILED = 'storage_migration_failed',

    // Blob storage - Configuration errors
    BLOB_INVALID_CONFIG = 'BLOB_INVALID_CONFIG',

    // Blob storage - Storage errors
    BLOB_SIZE_EXCEEDED = 'BLOB_SIZE_EXCEEDED',
    BLOB_TOTAL_SIZE_EXCEEDED = 'BLOB_TOTAL_SIZE_EXCEEDED',
    BLOB_INVALID_INPUT = 'BLOB_INVALID_INPUT',
    BLOB_ENCODING_ERROR = 'BLOB_ENCODING_ERROR',

    // Blob storage - Retrieval errors
    BLOB_NOT_FOUND = 'BLOB_NOT_FOUND',
    BLOB_INVALID_REFERENCE = 'BLOB_INVALID_REFERENCE',
    BLOB_ACCESS_DENIED = 'BLOB_ACCESS_DENIED',
    BLOB_CORRUPTED = 'BLOB_CORRUPTED',

    // Blob storage - Backend errors
    BLOB_BACKEND_NOT_CONNECTED = 'BLOB_BACKEND_NOT_CONNECTED',
    BLOB_BACKEND_UNAVAILABLE = 'BLOB_BACKEND_UNAVAILABLE',

    // Blob storage - Operation errors
    BLOB_CLEANUP_FAILED = 'BLOB_CLEANUP_FAILED',
    BLOB_OPERATION_FAILED = 'BLOB_OPERATION_FAILED',
}
