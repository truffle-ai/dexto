/**
 * FileSystem Service Errors
 *
 * Error classes for file system operations
 */

import { DextoRuntimeError, ErrorScope, ErrorType } from '@dexto/core';
import { FileSystemErrorCode } from './error-codes.js';

export interface FileSystemErrorContext {
    path?: string;
    pattern?: string;
    size?: number;
    maxSize?: number;
    encoding?: string;
    operation?: string;
}

/**
 * Factory class for creating FileSystem-related errors
 */
export class FileSystemError {
    private constructor() {
        // Private constructor prevents instantiation
    }

    /**
     * File not found error
     */
    static fileNotFound(path: string): DextoRuntimeError {
        return new DextoRuntimeError(
            FileSystemErrorCode.FILE_NOT_FOUND,
            ErrorScope.FILESYSTEM,
            ErrorType.NOT_FOUND,
            `File not found: ${path}`,
            { path }
        );
    }

    /**
     * Directory not found error
     */
    static directoryNotFound(path: string): DextoRuntimeError {
        return new DextoRuntimeError(
            FileSystemErrorCode.DIRECTORY_NOT_FOUND,
            ErrorScope.FILESYSTEM,
            ErrorType.NOT_FOUND,
            `Directory not found: ${path}`,
            { path }
        );
    }

    /**
     * Permission denied error
     */
    static permissionDenied(path: string, operation: string): DextoRuntimeError {
        return new DextoRuntimeError(
            FileSystemErrorCode.PERMISSION_DENIED,
            ErrorScope.FILESYSTEM,
            ErrorType.FORBIDDEN,
            `Permission denied: cannot ${operation} ${path}`,
            { path, operation }
        );
    }

    /**
     * Path not allowed error
     */
    static pathNotAllowed(path: string, allowedPaths: string[]): DextoRuntimeError {
        return new DextoRuntimeError(
            FileSystemErrorCode.PATH_NOT_ALLOWED,
            ErrorScope.FILESYSTEM,
            ErrorType.USER,
            `Path not allowed: ${path}. Must be within allowed paths: ${allowedPaths.join(', ')}`,
            { path, allowedPaths },
            'Ensure the path is within the configured allowed paths'
        );
    }

    /**
     * Path blocked error
     */
    static pathBlocked(path: string, reason: string): DextoRuntimeError {
        return new DextoRuntimeError(
            FileSystemErrorCode.PATH_BLOCKED,
            ErrorScope.FILESYSTEM,
            ErrorType.FORBIDDEN,
            `Path is blocked: ${path}. Reason: ${reason}`,
            { path, reason }
        );
    }

    /**
     * Invalid path error
     */
    static invalidPath(path: string, reason: string): DextoRuntimeError {
        return new DextoRuntimeError(
            FileSystemErrorCode.INVALID_PATH,
            ErrorScope.FILESYSTEM,
            ErrorType.USER,
            `Invalid path: ${path}. ${reason}`,
            { path, reason }
        );
    }

    /**
     * Path traversal detected
     */
    static pathTraversal(path: string): DextoRuntimeError {
        return new DextoRuntimeError(
            FileSystemErrorCode.PATH_TRAVERSAL_DETECTED,
            ErrorScope.FILESYSTEM,
            ErrorType.FORBIDDEN,
            `Path traversal detected in: ${path}`,
            { path }
        );
    }

    /**
     * Invalid file extension error
     */
    static invalidExtension(path: string, blockedExtensions: string[]): DextoRuntimeError {
        return new DextoRuntimeError(
            FileSystemErrorCode.INVALID_FILE_EXTENSION,
            ErrorScope.FILESYSTEM,
            ErrorType.USER,
            `Invalid file extension: ${path}. Blocked extensions: ${blockedExtensions.join(', ')}`,
            { path, blockedExtensions }
        );
    }

    /**
     * File too large error
     */
    static fileTooLarge(path: string, size: number, maxSize: number): DextoRuntimeError {
        return new DextoRuntimeError(
            FileSystemErrorCode.FILE_TOO_LARGE,
            ErrorScope.FILESYSTEM,
            ErrorType.USER,
            `File too large: ${path} (${size} bytes). Maximum allowed: ${maxSize} bytes`,
            { path, size, maxSize }
        );
    }

    /**
     * Too many results error
     */
    static tooManyResults(operation: string, count: number, maxResults: number): DextoRuntimeError {
        return new DextoRuntimeError(
            FileSystemErrorCode.TOO_MANY_RESULTS,
            ErrorScope.FILESYSTEM,
            ErrorType.USER,
            `Too many results from ${operation}: ${count}. Maximum allowed: ${maxResults}`,
            { operation, count, maxResults },
            'Narrow your search pattern or increase maxResults limit'
        );
    }

    /**
     * Read operation failed
     */
    static readFailed(path: string, cause: string): DextoRuntimeError {
        return new DextoRuntimeError(
            FileSystemErrorCode.READ_FAILED,
            ErrorScope.FILESYSTEM,
            ErrorType.SYSTEM,
            `Failed to read file: ${path}. ${cause}`,
            { path, cause }
        );
    }

    /**
     * Write operation failed
     */
    static writeFailed(path: string, cause: string): DextoRuntimeError {
        return new DextoRuntimeError(
            FileSystemErrorCode.WRITE_FAILED,
            ErrorScope.FILESYSTEM,
            ErrorType.SYSTEM,
            `Failed to write file: ${path}. ${cause}`,
            { path, cause }
        );
    }

    /**
     * Backup creation failed
     */
    static backupFailed(path: string, cause: string): DextoRuntimeError {
        return new DextoRuntimeError(
            FileSystemErrorCode.BACKUP_FAILED,
            ErrorScope.FILESYSTEM,
            ErrorType.SYSTEM,
            `Failed to create backup for: ${path}. ${cause}`,
            { path, cause }
        );
    }

    /**
     * Edit operation failed
     */
    static editFailed(path: string, cause: string): DextoRuntimeError {
        return new DextoRuntimeError(
            FileSystemErrorCode.EDIT_FAILED,
            ErrorScope.FILESYSTEM,
            ErrorType.SYSTEM,
            `Failed to edit file: ${path}. ${cause}`,
            { path, cause }
        );
    }

    /**
     * String not unique error
     */
    static stringNotUnique(
        path: string,
        searchString: string,
        occurrences: number
    ): DextoRuntimeError {
        return new DextoRuntimeError(
            FileSystemErrorCode.STRING_NOT_UNIQUE,
            ErrorScope.FILESYSTEM,
            ErrorType.USER,
            `String is not unique in ${path}: "${searchString}" found ${occurrences} times. Use replaceAll=true or provide a more specific string.`,
            { path, searchString, occurrences },
            'Use replaceAll option or provide more context in the search string'
        );
    }

    /**
     * String not found error
     */
    static stringNotFound(path: string, searchString: string): DextoRuntimeError {
        return new DextoRuntimeError(
            FileSystemErrorCode.STRING_NOT_FOUND,
            ErrorScope.FILESYSTEM,
            ErrorType.USER,
            `String not found in ${path}: "${searchString}"`,
            { path, searchString }
        );
    }

    /**
     * Glob operation failed
     */
    static globFailed(pattern: string, cause: string): DextoRuntimeError {
        return new DextoRuntimeError(
            FileSystemErrorCode.GLOB_FAILED,
            ErrorScope.FILESYSTEM,
            ErrorType.SYSTEM,
            `Glob operation failed for pattern: ${pattern}. ${cause}`,
            { pattern, cause }
        );
    }

    /**
     * Search operation failed
     */
    static searchFailed(pattern: string, cause: string): DextoRuntimeError {
        return new DextoRuntimeError(
            FileSystemErrorCode.SEARCH_FAILED,
            ErrorScope.FILESYSTEM,
            ErrorType.SYSTEM,
            `Search operation failed for pattern: ${pattern}. ${cause}`,
            { pattern, cause }
        );
    }

    /**
     * Invalid pattern error
     */
    static invalidPattern(pattern: string, cause: string): DextoRuntimeError {
        return new DextoRuntimeError(
            FileSystemErrorCode.INVALID_PATTERN,
            ErrorScope.FILESYSTEM,
            ErrorType.USER,
            `Invalid pattern: ${pattern}. ${cause}`,
            { pattern, cause }
        );
    }

    /**
     * Regex timeout error
     */
    static regexTimeout(pattern: string): DextoRuntimeError {
        return new DextoRuntimeError(
            FileSystemErrorCode.REGEX_TIMEOUT,
            ErrorScope.FILESYSTEM,
            ErrorType.TIMEOUT,
            `Regex operation timed out for pattern: ${pattern}`,
            { pattern },
            'Simplify your regex pattern or increase timeout'
        );
    }

    /**
     * Invalid configuration error
     */
    static invalidConfig(reason: string): DextoRuntimeError {
        return new DextoRuntimeError(
            FileSystemErrorCode.INVALID_CONFIG,
            ErrorScope.FILESYSTEM,
            ErrorType.USER,
            `Invalid FileSystem configuration: ${reason}`,
            { reason }
        );
    }

    /**
     * Service not initialized error
     */
    static notInitialized(): DextoRuntimeError {
        return new DextoRuntimeError(
            FileSystemErrorCode.SERVICE_NOT_INITIALIZED,
            ErrorScope.FILESYSTEM,
            ErrorType.SYSTEM,
            'FileSystemService has not been initialized',
            {},
            'Initialize the FileSystemService before using it'
        );
    }
}
