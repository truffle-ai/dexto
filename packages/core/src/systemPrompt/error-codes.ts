/**
 * SystemPrompt-specific error codes
 * Includes file processing and configuration errors
 */

export const SystemPromptErrorCode = {
    // File processing
    FILE_INVALID_TYPE: 'systemprompt_file_invalid_type',
    FILE_TOO_LARGE: 'systemprompt_file_too_large',
    FILE_READ_FAILED: 'systemprompt_file_read_failed',

    // Configuration
    CONTRIBUTOR_SOURCE_UNKNOWN: 'systemprompt_contributor_source_unknown',
    CONTRIBUTOR_CONFIG_INVALID: 'systemprompt_contributor_config_invalid',
} as const;

// eslint-disable-next-line @typescript-eslint/no-redeclare
export type SystemPromptErrorCode =
    (typeof SystemPromptErrorCode)[keyof typeof SystemPromptErrorCode];

export const SYSTEM_PROMPT_ERROR_CODES = Object.values(
    SystemPromptErrorCode
) as readonly SystemPromptErrorCode[];
