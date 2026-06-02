/**
 * Registry-specific error codes
 * Includes agent resolution, installation, and registry management errors
 */

export const REGISTRY_ERROR_CODES = [
    'registry_agent_not_found',
    'registry_agent_invalid_entry',
    'registry_agent_already_exists',
    'registry_installation_failed',
    'registry_installation_validation_failed',
    'registry_file_not_found',
    'registry_parse_error',
    'registry_write_error',
    'registry_config_not_found',
    'registry_main_config_missing',
    'registry_agent_not_installed',
    'registry_agent_protected',
    'registry_uninstallation_failed',
    'registry_agent_not_installed_auto_install_disabled',
] as const;

export type RegistryErrorCode = (typeof REGISTRY_ERROR_CODES)[number];

// eslint-disable-next-line @typescript-eslint/no-redeclare
export const RegistryErrorCode = {
    // Agent lookup errors
    AGENT_NOT_FOUND: 'registry_agent_not_found',
    AGENT_INVALID_ENTRY: 'registry_agent_invalid_entry',
    AGENT_ALREADY_EXISTS: 'registry_agent_already_exists',

    // Installation errors
    INSTALLATION_FAILED: 'registry_installation_failed',
    INSTALLATION_VALIDATION_FAILED: 'registry_installation_validation_failed',

    // Registry file errors
    REGISTRY_NOT_FOUND: 'registry_file_not_found',
    REGISTRY_PARSE_ERROR: 'registry_parse_error',
    REGISTRY_WRITE_ERROR: 'registry_write_error',

    // Config file errors
    CONFIG_NOT_FOUND: 'registry_config_not_found',
    MAIN_CONFIG_MISSING: 'registry_main_config_missing',

    // Uninstallation errors
    AGENT_NOT_INSTALLED: 'registry_agent_not_installed',
    AGENT_PROTECTED: 'registry_agent_protected',
    UNINSTALLATION_FAILED: 'registry_uninstallation_failed',

    // Auto-install control
    AGENT_NOT_INSTALLED_AUTO_INSTALL_DISABLED: 'registry_agent_not_installed_auto_install_disabled',
} as const;
