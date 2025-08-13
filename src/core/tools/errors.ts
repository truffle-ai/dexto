import { DextoRuntimeError } from '@core/errors/DextoRuntimeError.js';
import { ErrorScope, ErrorType } from '@core/errors/types.js';
import { ToolErrorCode } from './error-codes.js';

/**
 * Tool error factory with typed methods for creating tool-specific errors
 * Each method creates a properly typed DextoError with TOOLS scope
 */
export class ToolError {
    /**
     * Tool not found error
     */
    static notFound(toolName: string) {
        return new DextoRuntimeError(
            ToolErrorCode.TOOL_NOT_FOUND,
            ErrorScope.TOOLS,
            ErrorType.NOT_FOUND,
            `Tool '${toolName}' not found`,
            { toolName }
        );
    }

    /**
     * Tool execution failed
     */
    static executionFailed(toolName: string, reason: string, sessionId?: string) {
        return new DextoRuntimeError(
            ToolErrorCode.EXECUTION_FAILED,
            ErrorScope.TOOLS,
            ErrorType.SYSTEM,
            `Tool '${toolName}' execution failed: ${reason}`,
            { toolName, reason, sessionId }
        );
    }

    /**
     * Tool execution denied by user/policy
     */
    static executionDenied(toolName: string, sessionId?: string) {
        return new DextoRuntimeError(
            ToolErrorCode.EXECUTION_DENIED,
            ErrorScope.TOOLS,
            ErrorType.FORBIDDEN,
            `Tool '${toolName}' execution was denied by the user`,
            { toolName, sessionId }
        );
    }

    /**
     * Tool execution timeout
     */
    static executionTimeout(toolName: string, timeoutMs: number, sessionId?: string) {
        return new DextoRuntimeError(
            ToolErrorCode.EXECUTION_TIMEOUT,
            ErrorScope.TOOLS,
            ErrorType.TIMEOUT,
            `Tool '${toolName}' execution timed out after ${timeoutMs}ms`,
            { toolName, timeoutMs, sessionId }
        );
    }

    /**
     * Tool unauthorized access
     */
    static unauthorized(toolName: string, sessionId?: string) {
        return new DextoRuntimeError(
            ToolErrorCode.TOOL_UNAUTHORIZED,
            ErrorScope.TOOLS,
            ErrorType.FORBIDDEN,
            `Unauthorized access to tool '${toolName}'`,
            { toolName, sessionId }
        );
    }

    /**
     * Confirmation handler missing
     */
    static confirmationHandlerMissing(toolName: string) {
        return new DextoRuntimeError(
            ToolErrorCode.CONFIRMATION_HANDLER_MISSING,
            ErrorScope.TOOLS,
            ErrorType.SYSTEM,
            `Confirmation handler missing for tool '${toolName}'`,
            { toolName }
        );
    }

    /**
     * Confirmation timeout
     */
    static confirmationTimeout(toolName: string, timeoutMs: number, sessionId?: string) {
        return new DextoRuntimeError(
            ToolErrorCode.CONFIRMATION_TIMEOUT,
            ErrorScope.TOOLS,
            ErrorType.TIMEOUT,
            `Tool '${toolName}' confirmation timed out after ${timeoutMs}ms`,
            { toolName, timeoutMs, sessionId }
        );
    }

    /**
     * Invalid tool name (semantic validation - empty name after prefix, malformed, etc.)
     */
    static invalidName(toolName: string, reason: string) {
        return new DextoRuntimeError(
            ToolErrorCode.TOOL_INVALID_ARGS,
            ErrorScope.TOOLS,
            ErrorType.USER,
            `Invalid tool name '${toolName}': ${reason}`,
            { toolName, reason }
        );
    }

    /**
     * Internal tools provider not initialized
     */
    static internalToolsNotInitialized(toolName: string) {
        return new DextoRuntimeError(
            ToolErrorCode.EXECUTION_FAILED,
            ErrorScope.TOOLS,
            ErrorType.SYSTEM,
            `Internal tools not initialized, cannot execute: ${toolName}`,
            { toolName }
        );
    }
}
