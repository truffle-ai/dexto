/**
 * Storage-specific error codes
 * Includes cache, database, and blob storage errors
 */
export enum StorageErrorCode {
    // Manager lifecycle
    MANAGER_NOT_INITIALIZED = 'storage_manager_not_initialized',
    MANAGER_NOT_CONNECTED = 'storage_manager_not_connected',

    // Dependencies
    DEPENDENCY_NOT_INSTALLED = 'storage_dependency_not_installed',

    // Connection
    CONNECTION_FAILED = 'storage_connection_failed',
    CONNECTION_CONFIG_MISSING = 'storage_connection_config_missing',

    // Operations
    READ_FAILED = 'storage_read_failed',
    WRITE_FAILED = 'storage_write_failed',
    DELETE_FAILED = 'storage_delete_failed',

    // Database specific
    MIGRATION_FAILED = 'storage_migration_failed',
    DATABASE_INVALID_CONFIG = 'storage_database_invalid_config',

    // Cache specific
    CACHE_INVALID_CONFIG = 'storage_cache_invalid_config',

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

    // Blob storage - Provider registry errors
    BLOB_PROVIDER_UNKNOWN = 'BLOB_PROVIDER_UNKNOWN',
    BLOB_PROVIDER_ALREADY_REGISTERED = 'BLOB_PROVIDER_ALREADY_REGISTERED',

    // Database - Provider registry errors
    DATABASE_PROVIDER_UNKNOWN = 'DATABASE_PROVIDER_UNKNOWN',
    DATABASE_PROVIDER_ALREADY_REGISTERED = 'DATABASE_PROVIDER_ALREADY_REGISTERED',

    // Cache - Provider registry errors
    CACHE_PROVIDER_UNKNOWN = 'CACHE_PROVIDER_UNKNOWN',
    CACHE_PROVIDER_ALREADY_REGISTERED = 'CACHE_PROVIDER_ALREADY_REGISTERED',
}
