/**
 * Plugin-specific error codes
 * Used for plugin loading, validation, and execution errors
 */
export enum PluginErrorCode {
    /** Plugin file not found or cannot be loaded */
    PLUGIN_LOAD_FAILED = 'PLUGIN_LOAD_FAILED',

    /** Plugin does not implement required interface */
    PLUGIN_INVALID_SHAPE = 'PLUGIN_INVALID_SHAPE',

    /** Plugin constructor threw an error */
    PLUGIN_INSTANTIATION_FAILED = 'PLUGIN_INSTANTIATION_FAILED',

    /** Plugin initialization failed */
    PLUGIN_INITIALIZATION_FAILED = 'PLUGIN_INITIALIZATION_FAILED',

    /** Plugin configuration is invalid */
    PLUGIN_CONFIGURATION_INVALID = 'PLUGIN_CONFIGURATION_INVALID',

    /** Plugin execution failed */
    PLUGIN_EXECUTION_FAILED = 'PLUGIN_EXECUTION_FAILED',

    /** Plugin execution timed out */
    PLUGIN_EXECUTION_TIMEOUT = 'PLUGIN_EXECUTION_TIMEOUT',

    /** Plugin blocked execution */
    PLUGIN_BLOCKED_EXECUTION = 'PLUGIN_BLOCKED_EXECUTION',

    /** Duplicate plugin priority */
    PLUGIN_DUPLICATE_PRIORITY = 'PLUGIN_DUPLICATE_PRIORITY',
}

export type { PluginErrorCode as default };
