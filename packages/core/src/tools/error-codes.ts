/**
 * Tools-specific error codes
 * Includes tool execution, approval, and authorization errors
 */

export const ToolErrorCode = {
    // Execution
    EXECUTION_DENIED: 'tools_execution_denied',
    EXECUTION_TIMEOUT: 'tools_execution_timeout',
    EXECUTION_FAILED: 'tools_execution_failed',
    DIRECTORY_ACCESS_DENIED: 'tools_directory_access_denied',

    // Validation (pre-execution)
    VALIDATION_FAILED: 'tools_validation_failed',
    FILE_MODIFIED_SINCE_PREVIEW: 'tools_file_modified_since_preview',

    // Approval
    APPROVAL_HANDLER_MISSING: 'tools_approval_handler_missing',
    APPROVAL_TIMEOUT: 'tools_approval_timeout',
    APPROVAL_CANCELLED: 'tools_approval_cancelled',

    // Tool management
    TOOL_NOT_FOUND: 'tools_tool_not_found',
    TOOL_INVALID_ARGS: 'tools_invalid_args',
    TOOL_UNAUTHORIZED: 'tools_unauthorized',

    // Configuration
    CONFIG_INVALID: 'tools_config_invalid',
    FEATURE_DISABLED: 'tools_feature_disabled',

    // Custom tool factory registry
    CUSTOM_TOOL_FACTORY_UNKNOWN: 'tools_custom_factory_unknown',
    CUSTOM_TOOL_FACTORY_ALREADY_REGISTERED: 'tools_custom_factory_already_registered',
} as const;

// eslint-disable-next-line @typescript-eslint/no-redeclare
export type ToolErrorCode = (typeof ToolErrorCode)[keyof typeof ToolErrorCode];

export const TOOL_ERROR_CODES = Object.values(ToolErrorCode) as readonly ToolErrorCode[];
