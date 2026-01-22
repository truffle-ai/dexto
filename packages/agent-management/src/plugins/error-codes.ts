/**
 * Plugin-specific error codes
 * Includes discovery, validation, installation, and loading errors
 */
export enum PluginErrorCode {
    // Manifest errors
    MANIFEST_NOT_FOUND = 'plugin_manifest_not_found',
    MANIFEST_INVALID = 'plugin_manifest_invalid',
    MANIFEST_PARSE_ERROR = 'plugin_manifest_parse_error',

    // Loading errors
    DIRECTORY_READ_ERROR = 'plugin_directory_read_error',
    MCP_CONFIG_INVALID = 'plugin_mcp_config_invalid',

    // Discovery errors
    DUPLICATE_PLUGIN = 'plugin_duplicate',

    // Installation errors
    INSTALL_SOURCE_NOT_FOUND = 'plugin_install_source_not_found',
    INSTALL_ALREADY_EXISTS = 'plugin_install_already_exists',
    INSTALL_COPY_FAILED = 'plugin_install_copy_failed',
    INSTALL_MANIFEST_WRITE_FAILED = 'plugin_install_manifest_write_failed',

    // Uninstallation errors
    UNINSTALL_NOT_FOUND = 'plugin_uninstall_not_found',
    UNINSTALL_DELETE_FAILED = 'plugin_uninstall_delete_failed',
    UNINSTALL_MANIFEST_UPDATE_FAILED = 'plugin_uninstall_manifest_update_failed',

    // Validation errors
    VALIDATION_INVALID_STRUCTURE = 'plugin_validation_invalid_structure',
    VALIDATION_MISSING_REQUIRED = 'plugin_validation_missing_required',
}
