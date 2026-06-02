/**
 * Tools-specific error codes
 * Includes tool execution, approval, and authorization errors
 */

export const TOOL_ERROR_CODES = [
    'tools_execution_denied',
    'tools_execution_timeout',
    'tools_execution_failed',
    'tools_directory_access_denied',
    'tools_validation_failed',
    'tools_file_modified_since_preview',
    'tools_approval_handler_missing',
    'tools_approval_timeout',
    'tools_approval_cancelled',
    'tools_tool_not_found',
    'tools_invalid_args',
    'tools_unauthorized',
    'tools_config_invalid',
    'tools_feature_disabled',
    'tools_custom_factory_unknown',
    'tools_custom_factory_already_registered',
] as const;

export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];

const ToolErrorCodeValues = {
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
} as const satisfies Record<string, ToolErrorCode>;

export { ToolErrorCodeValues as ToolErrorCode };
