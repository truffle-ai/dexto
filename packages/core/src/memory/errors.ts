import { DextoRuntimeError } from '../errors/DextoRuntimeError.js';
import { MemoryErrorCode } from './error-codes.js';

/**
 * Memory error factory following the error pattern from config/errors.ts
 */
export class MemoryError {
    static notFound(id: string): DextoRuntimeError {
        return new DextoRuntimeError(
            MemoryErrorCode.MEMORY_NOT_FOUND,
            'memory',
            'not_found',
            `Memory not found: ${id}`,
            { id }
        );
    }

    static alreadyExists(id: string): DextoRuntimeError {
        return new DextoRuntimeError(
            MemoryErrorCode.MEMORY_ALREADY_EXISTS,
            'memory',
            'user',
            `Memory already exists: ${id}`,
            { id }
        );
    }

    static contentRequired(): DextoRuntimeError {
        return new DextoRuntimeError(
            MemoryErrorCode.MEMORY_CONTENT_REQUIRED,
            'memory',
            'user',
            'Memory content is required'
        );
    }

    static contentTooLong(length: number, maxLength: number): DextoRuntimeError {
        return new DextoRuntimeError(
            MemoryErrorCode.MEMORY_CONTENT_TOO_LONG,
            'memory',
            'user',
            `Memory content too long: ${length} characters (max: ${maxLength})`,
            { length, maxLength }
        );
    }

    static invalidId(id: string): DextoRuntimeError {
        return new DextoRuntimeError(
            MemoryErrorCode.MEMORY_INVALID_ID,
            'memory',
            'user',
            `Invalid memory ID: ${id}`,
            { id }
        );
    }

    static invalidTags(tags: unknown): DextoRuntimeError {
        return new DextoRuntimeError(
            MemoryErrorCode.MEMORY_INVALID_TAGS,
            'memory',
            'user',
            `Invalid tags format: ${JSON.stringify(tags)}`,
            { tags }
        );
    }

    static storageError(message: string, cause?: Error): DextoRuntimeError {
        return new DextoRuntimeError(
            MemoryErrorCode.MEMORY_STORAGE_ERROR,
            'memory',
            'system',
            `Memory storage error: ${message}`,
            { cause }
        );
    }

    static retrievalError(message: string, cause?: Error): DextoRuntimeError {
        return new DextoRuntimeError(
            MemoryErrorCode.MEMORY_RETRIEVAL_ERROR,
            'memory',
            'system',
            `Memory retrieval error: ${message}`,
            { cause }
        );
    }

    static deleteError(message: string, cause?: Error): DextoRuntimeError {
        return new DextoRuntimeError(
            MemoryErrorCode.MEMORY_DELETE_ERROR,
            'memory',
            'system',
            `Memory deletion error: ${message}`,
            { cause }
        );
    }
}
