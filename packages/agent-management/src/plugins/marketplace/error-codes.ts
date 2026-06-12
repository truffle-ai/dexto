/**
 * Plugin Marketplace Error Codes
 */

export const MARKETPLACE_ERROR_CODES = [
    'marketplace_registry_read_failed',
    'marketplace_registry_write_failed',
    'marketplace_add_already_exists',
    'marketplace_add_clone_failed',
    'marketplace_add_invalid_source',
    'marketplace_add_local_not_found',
    'marketplace_remove_not_found',
    'marketplace_remove_delete_failed',
    'marketplace_update_not_found',
    'marketplace_update_pull_failed',
    'marketplace_update_local_not_supported',
    'marketplace_install_marketplace_not_found',
    'marketplace_install_plugin_not_found',
    'marketplace_install_copy_failed',
    'marketplace_scan_failed',
] as const;

export type MarketplaceErrorCode = (typeof MARKETPLACE_ERROR_CODES)[number];

// eslint-disable-next-line @typescript-eslint/no-redeclare
export const MarketplaceErrorCode = {
    // Registry errors
    REGISTRY_READ_FAILED: 'marketplace_registry_read_failed',
    REGISTRY_WRITE_FAILED: 'marketplace_registry_write_failed',

    // Add marketplace errors
    ADD_ALREADY_EXISTS: 'marketplace_add_already_exists',
    ADD_CLONE_FAILED: 'marketplace_add_clone_failed',
    ADD_INVALID_SOURCE: 'marketplace_add_invalid_source',
    ADD_LOCAL_NOT_FOUND: 'marketplace_add_local_not_found',

    // Remove marketplace errors
    REMOVE_NOT_FOUND: 'marketplace_remove_not_found',
    REMOVE_DELETE_FAILED: 'marketplace_remove_delete_failed',

    // Update marketplace errors
    UPDATE_NOT_FOUND: 'marketplace_update_not_found',
    UPDATE_PULL_FAILED: 'marketplace_update_pull_failed',
    UPDATE_LOCAL_NOT_SUPPORTED: 'marketplace_update_local_not_supported',

    // Install from marketplace errors
    INSTALL_MARKETPLACE_NOT_FOUND: 'marketplace_install_marketplace_not_found',
    INSTALL_PLUGIN_NOT_FOUND: 'marketplace_install_plugin_not_found',
    INSTALL_COPY_FAILED: 'marketplace_install_copy_failed',

    // Scan errors
    SCAN_FAILED: 'marketplace_scan_failed',
} as const;
