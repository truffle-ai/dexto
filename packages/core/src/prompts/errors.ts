import { DextoRuntimeError } from '@core/errors/DextoRuntimeError.js';
import { DextoValidationError } from '@core/errors/DextoValidationError.js';
import { ErrorScope, ErrorType } from '@core/errors/types.js';
import { SystemPromptErrorCode } from '@core/systemPrompt/error-codes.js';

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
            SystemPromptErrorCode.CONTRIBUTOR_CONFIG_INVALID,
            ErrorScope.SYSTEM_PROMPT,
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
                code: SystemPromptErrorCode.CONTRIBUTOR_CONFIG_INVALID,
                message: 'Starter prompt missing prompt text',
                scope: ErrorScope.SYSTEM_PROMPT,
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
                code: SystemPromptErrorCode.CONTRIBUTOR_CONFIG_INVALID,
                message: `Missing required arguments: ${missingNames.join(', ')}`,
                scope: ErrorScope.SYSTEM_PROMPT,
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
            SystemPromptErrorCode.CONTRIBUTOR_SOURCE_UNKNOWN,
            ErrorScope.SYSTEM_PROMPT,
            ErrorType.NOT_FOUND,
            `No provider found for prompt source: ${source}`,
            { source }
        );
    }
}
