/**
 * Plugin-specific error codes
 * Includes discovery, validation, and loading errors
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
}
