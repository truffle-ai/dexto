/**
 * Storage-specific error codes
 * Includes database, file system, and persistence errors
 */
export const enum StorageErrorCode {
    // Connection
    CONNECTION_FAILED = 'storage_connection_failed',
    CONNECTION_CONFIG_MISSING = 'storage_connection_config_missing',

    // Operations
    READ_FAILED = 'storage_read_failed',
    WRITE_FAILED = 'storage_write_failed',
    DELETE_FAILED = 'storage_delete_failed',

    // Database specific
    MIGRATION_FAILED = 'storage_migration_failed',
}
