import { DextoRuntimeError } from '../errors/DextoRuntimeError.js';
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
            'tools',
            'not_found',
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
            'tools',
            'system',
            `Tool '${toolName}' execution failed: ${reason}`,
            { toolName, reason, sessionId }
        );
    }

    /**
     * Tool execution denied by user/policy
     * @param toolName - Name of the tool that was denied
     * @param sessionId - Optional session ID
     * @param userMessage - Optional message from user (e.g., feedback for plan review)
     */
    static executionDenied(toolName: string, sessionId?: string, userMessage?: string) {
        const message = userMessage
            ? `Tool '${toolName}' was denied. ${userMessage}`
            : `Tool '${toolName}' execution was denied by the user`;
        return new DextoRuntimeError(
            ToolErrorCode.EXECUTION_DENIED,
            'tools',
            'forbidden',
            message,
            { toolName, sessionId, userMessage }
        );
    }

    /**
     * Directory access denied by user
     * Used when a file tool tries to access a path outside allowed directories
     * and the user denies the directory access approval
     */
    static directoryAccessDenied(directory: string, sessionId?: string) {
        return new DextoRuntimeError(
            ToolErrorCode.DIRECTORY_ACCESS_DENIED,
            'tools',
            'forbidden',
            `Access to directory '${directory}' was denied`,
            { directory, sessionId },
            'Request access to the directory or work within the allowed working directory'
        );
    }

    /**
     * Tool execution timeout
     */
    static executionTimeout(toolName: string, timeoutMs: number, sessionId?: string) {
        const message =
            timeoutMs > 0
                ? `Tool '${toolName}' execution timed out after ${timeoutMs}ms`
                : `Tool '${toolName}' execution timed out`;
        return new DextoRuntimeError(ToolErrorCode.EXECUTION_TIMEOUT, 'tools', 'timeout', message, {
            toolName,
            timeoutMs,
            sessionId,
        });
    }

    /**
     * Tool validation failed (pre-execution check)
     * Used when tool inputs are semantically invalid (e.g., file not found, string not in file)
     * This should fail before approval, not after.
     */
    static validationFailed(toolName: string, reason: string, context?: Record<string, unknown>) {
        return new DextoRuntimeError(
            ToolErrorCode.VALIDATION_FAILED,
            'tools',
            'user',
            `Tool '${toolName}' validation failed: ${reason}`,
            { toolName, reason, ...context }
        );
    }

    /**
     * File was modified between preview and execute.
     * This is a safety check to prevent corrupting user edits.
     */
    static fileModifiedSincePreview(toolName: string, filePath: string) {
        return new DextoRuntimeError(
            ToolErrorCode.FILE_MODIFIED_SINCE_PREVIEW,
            'tools',
            'user',
            `File '${filePath}' was modified since the preview was generated. Please read the file again and retry the operation.`,
            {
                toolName,
                filePath,
                recovery:
                    'Read the file with read_file tool to get current content, then retry the edit.',
            }
        );
    }

    /**
     * Tool unauthorized access
     */
    static unauthorized(toolName: string, sessionId?: string) {
        return new DextoRuntimeError(
            ToolErrorCode.TOOL_UNAUTHORIZED,
            'tools',
            'forbidden',
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
            'tools',
            'system',
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
            'tools',
            'timeout',
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
            'tools',
            'user',
            `Invalid tool name '${toolName}': ${reason}`,
            { toolName, reason }
        );
    }

    /**
     * Invalid tool configuration
     */
    static configInvalid(message: string) {
        return new DextoRuntimeError(ToolErrorCode.CONFIG_INVALID, 'tools', 'user', message, {});
    }

    /**
     * Confirmation cancelled
     */
    static confirmationCancelled(toolName: string, reason: string) {
        return new DextoRuntimeError(
            ToolErrorCode.CONFIRMATION_CANCELLED,
            'tools',
            'user',
            `Tool confirmation for '${toolName}' was cancelled: ${reason}`,
            { toolName, reason }
        );
    }

    /**
     * Tool requires features which are currently disabled
     */
    static featureDisabled(
        toolName: string,
        missingFeatures: string[],
        message: string
    ): DextoRuntimeError<{ toolName: string; missingFeatures: string[] }> {
        return new DextoRuntimeError(
            ToolErrorCode.FEATURE_DISABLED,
            'tools',
            'user',
            message,
            { toolName, missingFeatures },
            [
                `Remove '${toolName}' from tools[].enabledTools (builtin-tools) in your agent config`,
                `Or enable required features: ${missingFeatures.map((f) => `${f}.enabled: true`).join(', ')}`,
            ]
        );
    }

    /**
     * Unknown custom tool factory type
     */
    static unknownCustomToolFactory(type: string, availableTypes: string[]): DextoRuntimeError {
        return new DextoRuntimeError(
            ToolErrorCode.CUSTOM_TOOL_FACTORY_UNKNOWN,
            'tools',
            'user',
            `Unknown custom tool factory: '${type}'`,
            { type, availableTypes },
            `Available types: ${availableTypes.length > 0 ? availableTypes.join(', ') : 'none'}`
        );
    }

    /**
     * Custom tool factory already registered
     */
    static customToolFactoryAlreadyRegistered(type: string): DextoRuntimeError {
        return new DextoRuntimeError(
            ToolErrorCode.CUSTOM_TOOL_FACTORY_ALREADY_REGISTERED,
            'tools',
            'user',
            `Custom tool factory '${type}' is already registered`,
            { type },
            `Use unregister() first if you want to replace it`
        );
    }
}
