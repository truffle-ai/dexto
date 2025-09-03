import { DextoRuntimeError } from '@core/errors/DextoRuntimeError.js';
import { DextoValidationError } from '@core/errors/DextoValidationError.js';
import { ErrorScope, ErrorType } from '@core/errors/types.js';
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
            ErrorScope.SYSTEM_PROMPT, // Using SYSTEM_PROMPT scope as prompts are part of system functionality
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
                code: PromptErrorCode.MISSING_TEXT,
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
                code: PromptErrorCode.MISSING_REQUIRED_ARGUMENTS,
                message: `Missing required arguments: ${missingNames.join(', ')}`,
                scope: ErrorScope.SYSTEM_PROMPT,
                type: ErrorType.USER,
                severity: 'error',
                context: { missingNames },
            },
        ]);
    }
}
