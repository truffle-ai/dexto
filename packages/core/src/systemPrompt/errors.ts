import { DextoRuntimeError } from '../errors/DextoRuntimeError.js';
import { ErrorScope, ErrorType } from '../errors/types.js';
import { SystemPromptErrorCode } from './error-codes.js';
import { safeStringify } from '../utils/safe-stringify.js';

/**
 * SystemPrompt error factory with typed methods for creating systemPrompt-specific errors
 * Each method creates a properly typed DextoRuntimeError with SYSTEM_PROMPT scope
 */
export class SystemPromptError {
    /**
     * Invalid file type error
     */
    static invalidFileType(filePath: string, allowedExtensions: string[]) {
        return new DextoRuntimeError(
            SystemPromptErrorCode.FILE_INVALID_TYPE,
            ErrorScope.SYSTEM_PROMPT,
            ErrorType.USER,
            `File ${filePath} is not a ${allowedExtensions.join(' or ')} file`,
            { filePath, allowedExtensions }
        );
    }

    /**
     * File too large error
     */
    static fileTooLarge(filePath: string, fileSize: number, maxSize: number) {
        return new DextoRuntimeError(
            SystemPromptErrorCode.FILE_TOO_LARGE,
            ErrorScope.SYSTEM_PROMPT,
            ErrorType.USER,
            `File ${filePath} exceeds maximum size of ${maxSize} bytes`,
            { filePath, fileSize, maxSize }
        );
    }

    /**
     * File read failed error
     */
    static fileReadFailed(filePath: string, reason: string) {
        return new DextoRuntimeError(
            SystemPromptErrorCode.FILE_READ_FAILED,
            ErrorScope.SYSTEM_PROMPT,
            ErrorType.SYSTEM,
            `Failed to read file ${filePath}: ${reason}`,
            { filePath, reason }
        );
    }

    /**
     * Unknown contributor source error
     */
    static unknownContributorSource(source: string) {
        return new DextoRuntimeError(
            SystemPromptErrorCode.CONTRIBUTOR_SOURCE_UNKNOWN,
            ErrorScope.SYSTEM_PROMPT,
            ErrorType.USER,
            `No generator registered for dynamic contributor source: ${source}`,
            { source }
        );
    }

    /**
     * Invalid contributor config error (for exhaustive type checking)
     */
    static invalidContributorConfig(config: unknown): DextoRuntimeError {
        return new DextoRuntimeError(
            SystemPromptErrorCode.CONTRIBUTOR_CONFIG_INVALID,
            ErrorScope.SYSTEM_PROMPT,
            ErrorType.USER,
            `Invalid contributor config: ${safeStringify(config)}`,
            { config }
        );
    }
}
