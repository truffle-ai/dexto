/**
 * Prompt-specific error codes
 * Includes prompt resolution and validation errors
 */
export enum PromptErrorCode {
    // Prompt resolution
    PROMPT_NOT_FOUND = 'prompt_not_found',
    PROVIDER_NOT_FOUND = 'provider_not_found',
    PROMPT_NAME_REQUIRED = 'prompt_name_required',
    PROMPT_EMPTY_CONTENT = 'prompt_empty_content',

    // Prompt validation
    MISSING_TEXT = 'prompt_missing_text',
    MISSING_REQUIRED_ARGUMENTS = 'prompt_missing_required_arguments',
}
