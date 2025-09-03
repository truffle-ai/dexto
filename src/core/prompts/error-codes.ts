/**
 * Prompt-specific error codes
 * Includes prompt resolution and validation errors
 */
export enum PromptErrorCode {
    // Prompt resolution
    PROMPT_NOT_FOUND = 'prompt_not_found',

    // Prompt validation
    MISSING_TEXT = 'prompt_missing_text',
}
