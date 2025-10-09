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

    const context = options.context ?? 'Prompt name';
    const hint = options.hint ? ` ${options.hint}` : '';
    throw new Error(`${context} '${name}' must be ${PROMPT_NAME_GUIDANCE}.${hint}`);
}
