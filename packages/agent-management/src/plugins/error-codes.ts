/**
 * Plugin-specific error codes
 * Includes discovery, validation, installation, and loading errors
 */

export const PLUGIN_ERROR_CODES = [
    'plugin_manifest_not_found',
    'plugin_manifest_invalid',
    'plugin_manifest_parse_error',
    'plugin_directory_read_error',
    'plugin_mcp_config_invalid',
    'plugin_duplicate',
    'plugin_install_source_not_found',
    'plugin_install_already_exists',
    'plugin_install_copy_failed',
    'plugin_install_manifest_write_failed',
    'plugin_install_invalid_scope',
    'plugin_import_not_found',
    'plugin_uninstall_not_found',
    'plugin_uninstall_delete_failed',
    'plugin_uninstall_manifest_update_failed',
    'plugin_validation_invalid_structure',
    'plugin_validation_missing_required',
] as const;

export type PluginErrorCode = (typeof PLUGIN_ERROR_CODES)[number];

const PluginErrorCodeValues = {
    // Manifest errors
    MANIFEST_NOT_FOUND: 'plugin_manifest_not_found',
    MANIFEST_INVALID: 'plugin_manifest_invalid',
    MANIFEST_PARSE_ERROR: 'plugin_manifest_parse_error',

    // Loading errors
    DIRECTORY_READ_ERROR: 'plugin_directory_read_error',
    MCP_CONFIG_INVALID: 'plugin_mcp_config_invalid',

    // Discovery errors
    DUPLICATE_PLUGIN: 'plugin_duplicate',

    // Installation errors
    INSTALL_SOURCE_NOT_FOUND: 'plugin_install_source_not_found',
    INSTALL_ALREADY_EXISTS: 'plugin_install_already_exists',
    INSTALL_COPY_FAILED: 'plugin_install_copy_failed',
    INSTALL_MANIFEST_WRITE_FAILED: 'plugin_install_manifest_write_failed',
    INSTALL_INVALID_SCOPE: 'plugin_install_invalid_scope',

    // Import errors
    IMPORT_NOT_FOUND: 'plugin_import_not_found',

    // Uninstallation errors
    UNINSTALL_NOT_FOUND: 'plugin_uninstall_not_found',
    UNINSTALL_DELETE_FAILED: 'plugin_uninstall_delete_failed',
    UNINSTALL_MANIFEST_UPDATE_FAILED: 'plugin_uninstall_manifest_update_failed',

    // Validation errors
    VALIDATION_INVALID_STRUCTURE: 'plugin_validation_invalid_structure',
    VALIDATION_MISSING_REQUIRED: 'plugin_validation_missing_required',
} as const satisfies Record<string, PluginErrorCode>;

export { PluginErrorCodeValues as PluginErrorCode };
