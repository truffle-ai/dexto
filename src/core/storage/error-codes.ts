/**
 * Storage-specific error codes
 * Includes database, file system, and persistence errors
 */
export const enum StorageErrorCode {
    // Connection
    CONNECTION_FAILED = 'storage_connection_failed',
    CONNECTION_LOST = 'storage_connection_lost',

    // Operations
    READ_FAILED = 'storage_read_failed',
    WRITE_FAILED = 'storage_write_failed',
    DELETE_FAILED = 'storage_delete_failed',

    // Resources
    RESOURCE_NOT_FOUND = 'storage_resource_not_found',
    RESOURCE_ALREADY_EXISTS = 'storage_resource_already_exists',

    // Database specific
    MIGRATION_FAILED = 'storage_migration_failed',
    TRANSACTION_FAILED = 'storage_transaction_failed',
}
