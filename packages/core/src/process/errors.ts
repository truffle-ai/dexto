/**
 * Process Service Errors
 *
 * Error classes for process execution and management
 */

import { DextoRuntimeError } from '../errors/index.js';
import { ErrorScope, ErrorType } from '../errors/types.js';
import { ProcessErrorCode } from './error-codes.js';

export interface ProcessErrorContext {
    command?: string;
    processId?: string;
    timeout?: number;
    [key: string]: unknown;
}

/**
 * Factory class for creating Process-related errors
 */
export class ProcessError {
    private constructor() {
        // Private constructor prevents instantiation
    }

    /**
     * Invalid command error
     */
    static invalidCommand(command: string, reason: string): DextoRuntimeError {
        return new DextoRuntimeError(
            ProcessErrorCode.INVALID_COMMAND,
            ErrorScope.PROCESS,
            ErrorType.USER,
            `Invalid command: ${command}. ${reason}`,
            { command, reason }
        );
    }

    /**
     * Command blocked error
     */
    static commandBlocked(command: string, reason: string): DextoRuntimeError {
        return new DextoRuntimeError(
            ProcessErrorCode.COMMAND_BLOCKED,
            ErrorScope.PROCESS,
            ErrorType.FORBIDDEN,
            `Command is blocked: ${command}. ${reason}`,
            { command, reason }
        );
    }

    /**
     * Command too long error
     */
    static commandTooLong(length: number, maxLength: number): DextoRuntimeError {
        return new DextoRuntimeError(
            ProcessErrorCode.COMMAND_TOO_LONG,
            ErrorScope.PROCESS,
            ErrorType.USER,
            `Command too long: ${length} characters. Maximum allowed: ${maxLength}`,
            { length, maxLength }
        );
    }

    /**
     * Command injection detected error
     */
    static commandInjection(command: string, pattern: string): DextoRuntimeError {
        return new DextoRuntimeError(
            ProcessErrorCode.INJECTION_DETECTED,
            ErrorScope.PROCESS,
            ErrorType.FORBIDDEN,
            `Potential command injection detected in: ${command}. Pattern: ${pattern}`,
            { command, pattern }
        );
    }

    /**
     * Command approval required error
     */
    static approvalRequired(command: string, reason?: string): DextoRuntimeError {
        return new DextoRuntimeError(
            ProcessErrorCode.APPROVAL_REQUIRED,
            ErrorScope.PROCESS,
            ErrorType.FORBIDDEN,
            `Command requires approval: ${command}${reason ? `. ${reason}` : ''}`,
            { command, reason },
            'Provide an approval function to execute dangerous commands'
        );
    }

    /**
     * Command approval denied error
     */
    static approvalDenied(command: string): DextoRuntimeError {
        return new DextoRuntimeError(
            ProcessErrorCode.APPROVAL_DENIED,
            ErrorScope.PROCESS,
            ErrorType.FORBIDDEN,
            `Command approval denied by user: ${command}`,
            { command }
        );
    }

    /**
     * Command execution failed error
     */
    static executionFailed(command: string, cause: string): DextoRuntimeError {
        return new DextoRuntimeError(
            ProcessErrorCode.EXECUTION_FAILED,
            ErrorScope.PROCESS,
            ErrorType.SYSTEM,
            `Command execution failed: ${command}. ${cause}`,
            { command, cause }
        );
    }

    /**
     * Command timeout error
     */
    static timeout(command: string, timeout: number): DextoRuntimeError {
        return new DextoRuntimeError(
            ProcessErrorCode.TIMEOUT,
            ErrorScope.PROCESS,
            ErrorType.TIMEOUT,
            `Command timed out after ${timeout}ms: ${command}`,
            { command, timeout },
            'Increase timeout or optimize the command'
        );
    }

    /**
     * Permission denied error
     */
    static permissionDenied(command: string): DextoRuntimeError {
        return new DextoRuntimeError(
            ProcessErrorCode.PERMISSION_DENIED,
            ErrorScope.PROCESS,
            ErrorType.FORBIDDEN,
            `Permission denied: ${command}`,
            { command }
        );
    }

    /**
     * Command not found error
     */
    static commandNotFound(command: string): DextoRuntimeError {
        return new DextoRuntimeError(
            ProcessErrorCode.COMMAND_NOT_FOUND,
            ErrorScope.PROCESS,
            ErrorType.NOT_FOUND,
            `Command not found: ${command}`,
            { command },
            'Ensure the command is installed and available in PATH'
        );
    }

    /**
     * Invalid working directory error
     */
    static invalidWorkingDirectory(path: string, reason: string): DextoRuntimeError {
        return new DextoRuntimeError(
            ProcessErrorCode.WORKING_DIRECTORY_INVALID,
            ErrorScope.PROCESS,
            ErrorType.USER,
            `Invalid working directory: ${path}. ${reason}`,
            { path, reason }
        );
    }

    /**
     * Process not found error
     */
    static processNotFound(processId: string): DextoRuntimeError {
        return new DextoRuntimeError(
            ProcessErrorCode.PROCESS_NOT_FOUND,
            ErrorScope.PROCESS,
            ErrorType.NOT_FOUND,
            `Process not found: ${processId}`,
            { processId }
        );
    }

    /**
     * Too many concurrent processes error
     */
    static tooManyProcesses(current: number, max: number): DextoRuntimeError {
        return new DextoRuntimeError(
            ProcessErrorCode.TOO_MANY_PROCESSES,
            ErrorScope.PROCESS,
            ErrorType.USER,
            `Too many concurrent processes: ${current}. Maximum allowed: ${max}`,
            { current, max },
            'Wait for running processes to complete or increase the limit'
        );
    }

    /**
     * Kill process failed error
     */
    static killFailed(processId: string, cause: string): DextoRuntimeError {
        return new DextoRuntimeError(
            ProcessErrorCode.KILL_FAILED,
            ErrorScope.PROCESS,
            ErrorType.SYSTEM,
            `Failed to kill process ${processId}: ${cause}`,
            { processId, cause }
        );
    }

    /**
     * Output buffer full error
     */
    static outputBufferFull(processId: string, size: number, maxSize: number): DextoRuntimeError {
        return new DextoRuntimeError(
            ProcessErrorCode.OUTPUT_BUFFER_FULL,
            ErrorScope.PROCESS,
            ErrorType.SYSTEM,
            `Output buffer full for process ${processId}: ${size} bytes. Maximum: ${maxSize}`,
            { processId, size, maxSize },
            'Process output exceeded buffer limit'
        );
    }

    /**
     * Invalid configuration error
     */
    static invalidConfig(reason: string): DextoRuntimeError {
        return new DextoRuntimeError(
            ProcessErrorCode.INVALID_CONFIG,
            ErrorScope.PROCESS,
            ErrorType.USER,
            `Invalid Process configuration: ${reason}`,
            { reason }
        );
    }

    /**
     * Service not initialized error
     */
    static notInitialized(): DextoRuntimeError {
        return new DextoRuntimeError(
            ProcessErrorCode.SERVICE_NOT_INITIALIZED,
            ErrorScope.PROCESS,
            ErrorType.SYSTEM,
            'ProcessService has not been initialized',
            {},
            'Initialize the ProcessService before using it'
        );
    }
}
