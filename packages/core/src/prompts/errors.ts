import { DextoRuntimeError } from '../errors/DextoRuntimeError.js';
import { DextoValidationError } from '../errors/DextoValidationError.js';
import { ErrorScope, ErrorType } from '../errors/types.js';
import { PromptErrorCode } from './error-codes.js';

/**
 * Prompt error factory with typed methods for creating prompt-specific errors
 * Each method creates a properly typed error with appropriate scope
 */
export class PromptError {
    /**
     * Prompt not found error
     */
    static notFound(name: string) {
        return new DextoRuntimeError(
            PromptErrorCode.PROMPT_NOT_FOUND,
            ErrorScope.PROMPT,
            ErrorType.NOT_FOUND,
            `Prompt not found: ${name}`,
            { name }
        );
    }

    /**
     * Missing prompt text validation error
     */
    static missingText() {
        return new DextoValidationError([
            {
                code: PromptErrorCode.PROMPT_MISSING_TEXT,
                message: 'Prompt missing text content',
                scope: ErrorScope.PROMPT,
                type: ErrorType.USER,
                severity: 'error',
                context: {},
            },
        ]);
    }

    /**
     * Missing required arguments validation error
     */
    static missingRequiredArguments(missingNames: string[]) {
        return new DextoValidationError([
            {
                code: PromptErrorCode.PROMPT_MISSING_REQUIRED_ARGUMENTS,
                message: `Missing required arguments: ${missingNames.join(', ')}`,
                scope: ErrorScope.PROMPT,
                type: ErrorType.USER,
                severity: 'error',
                context: { missingNames },
            },
        ]);
    }

    /**
     * Provider not found error
     */
    static providerNotFound(source: string) {
        return new DextoRuntimeError(
            PromptErrorCode.PROMPT_PROVIDER_NOT_FOUND,
            ErrorScope.PROMPT,
            ErrorType.NOT_FOUND,
            `No provider found for prompt source: ${source}`,
            { source }
        );
    }

    /**
     * Missing prompt name in request (validation)
     */
    static nameRequired() {
        return new DextoValidationError([
            {
                code: PromptErrorCode.PROMPT_NAME_REQUIRED,
                message: 'Prompt name is required',
                scope: ErrorScope.PROMPT,
                type: ErrorType.USER,
                severity: 'error',
                context: {},
            },
        ]);
    }

    /**
     * Invalid prompt name format validation error
     */
    static invalidName(name: string, guidance: string, context?: string, hint?: string) {
        const contextPrefix = context ?? 'Prompt name';
        const hintSuffix = hint ? ` ${hint}` : '';
        return new DextoValidationError([
            {
                code: PromptErrorCode.PROMPT_INVALID_NAME,
                message: `${contextPrefix} '${name}' must be ${guidance}.${hintSuffix}`,
                scope: ErrorScope.PROMPT,
                type: ErrorType.USER,
                severity: 'error',
                context: { name, guidance },
            },
        ]);
    }

    /** Duplicate prompt name validation error */
    static alreadyExists(name: string) {
        return new DextoValidationError([
            {
                code: PromptErrorCode.PROMPT_ALREADY_EXISTS,
                message: `Prompt already exists: ${name}`,
                scope: ErrorScope.PROMPT,
                type: ErrorType.USER,
                severity: 'error',
                context: { name },
            },
        ]);
    }

    /**
     * Prompt resolved to empty content
     */
    static emptyResolvedContent(name: string) {
        return new DextoRuntimeError(
            PromptErrorCode.PROMPT_EMPTY_CONTENT,
            ErrorScope.PROMPT,
            ErrorType.NOT_FOUND,
            `Prompt resolved to empty content: ${name}`,
            { name }
        );
    }

    /**
     * Prompts config validation failed
     */
    static validationFailed(details: string) {
        return new DextoValidationError([
            {
                code: PromptErrorCode.PROMPT_CONFIG_INVALID,
                message: `Invalid prompts configuration: ${details}`,
                scope: ErrorScope.PROMPT,
                type: ErrorType.USER,
                severity: 'error',
                context: { details },
            },
        ]);
    }
}
