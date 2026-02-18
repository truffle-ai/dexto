/**
 * Error codes for the approval system
 * Covers validation, timeout, cancellation, and provider errors
 */
export enum ApprovalErrorCode {
    // Validation errors
    APPROVAL_INVALID_REQUEST = 'approval_invalid_request',
    APPROVAL_INVALID_RESPONSE = 'approval_invalid_response',
    APPROVAL_INVALID_METADATA = 'approval_invalid_metadata',
    APPROVAL_INVALID_SCHEMA = 'approval_invalid_schema',

    // Timeout errors
    APPROVAL_TIMEOUT = 'approval_timeout',

    // Cancellation errors
    APPROVAL_CANCELLED = 'approval_cancelled',
    APPROVAL_CANCELLED_ALL = 'approval_cancelled_all',

    // Provider errors
    APPROVAL_PROVIDER_NOT_CONFIGURED = 'approval_provider_not_configured',
    APPROVAL_PROVIDER_ERROR = 'approval_provider_error',
    APPROVAL_NOT_FOUND = 'approval_not_found',

    // Type-specific errors
    APPROVAL_TOOL_APPROVAL_DENIED = 'approval_tool_confirmation_denied',
    APPROVAL_ELICITATION_DENIED = 'approval_elicitation_denied',
    APPROVAL_ELICITATION_VALIDATION_FAILED = 'approval_elicitation_validation_failed',

    // Configuration errors
    APPROVAL_CONFIG_INVALID = 'approval_config_invalid',
}
