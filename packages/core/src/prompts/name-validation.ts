import { PromptError } from './errors.js';

export const PROMPT_NAME_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const PROMPT_NAME_GUIDANCE =
    'kebab-case (lowercase letters and numbers separated by single hyphens)';

export interface PromptNameValidationOptions {
    context?: string;
    hint?: string;
}

export function isValidPromptName(name: string): boolean {
    return PROMPT_NAME_REGEX.test(name);
}

export function assertValidPromptName(
    name: string,
    options: PromptNameValidationOptions = {}
): void {
    if (isValidPromptName(name)) {
        return;
    }

    throw PromptError.invalidName(name, PROMPT_NAME_GUIDANCE, options.context, options.hint);
}
