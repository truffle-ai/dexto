/**
 * Prompt-specific error codes
 * Includes prompt resolution, validation, and provider errors
 */
export enum PromptErrorCode {
    // Prompt resolution errors
    PROMPT_NOT_FOUND = 'prompt_not_found',
    PROMPT_EMPTY_CONTENT = 'prompt_empty_content',
    PROMPT_PROVIDER_NOT_FOUND = 'prompt_provider_not_found',

    // Validation errors
    PROMPT_NAME_REQUIRED = 'prompt_name_required',
    PROMPT_INVALID_NAME = 'prompt_invalid_name',
    PROMPT_MISSING_TEXT = 'prompt_missing_text',
    PROMPT_MISSING_REQUIRED_ARGUMENTS = 'prompt_missing_required_arguments',
    PROMPT_ALREADY_EXISTS = 'prompt_already_exists',
    PROMPT_CONFIG_INVALID = 'prompt_config_invalid',
}
