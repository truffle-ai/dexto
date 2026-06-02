/**
 * Prompt-specific error codes
 * Includes prompt resolution, validation, and provider errors
 */

export const PROMPT_ERROR_CODES = [
    'prompt_not_found',
    'prompt_empty_content',
    'prompt_provider_not_found',
    'prompt_name_required',
    'prompt_invalid_name',
    'prompt_missing_text',
    'prompt_missing_required_arguments',
    'prompt_already_exists',
    'prompt_config_invalid',
] as const;

export type PromptErrorCode = (typeof PROMPT_ERROR_CODES)[number];

const PromptErrorCodeValues = {
    // Prompt resolution errors
    PROMPT_NOT_FOUND: 'prompt_not_found',
    PROMPT_EMPTY_CONTENT: 'prompt_empty_content',
    PROMPT_PROVIDER_NOT_FOUND: 'prompt_provider_not_found',

    // Validation errors
    PROMPT_NAME_REQUIRED: 'prompt_name_required',
    PROMPT_INVALID_NAME: 'prompt_invalid_name',
    PROMPT_MISSING_TEXT: 'prompt_missing_text',
    PROMPT_MISSING_REQUIRED_ARGUMENTS: 'prompt_missing_required_arguments',
    PROMPT_ALREADY_EXISTS: 'prompt_already_exists',
    PROMPT_CONFIG_INVALID: 'prompt_config_invalid',
} as const satisfies Record<string, PromptErrorCode>;

export { PromptErrorCodeValues as PromptErrorCode };
