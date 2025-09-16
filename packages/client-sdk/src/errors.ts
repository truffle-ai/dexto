import {
    DextoRuntimeError,
    DextoValidationError,
    ErrorScope,
    ErrorType,
    Issue,
    type DextoErrorCode,
} from '@dexto/core';

/**
 * Client SDK error factory
 * Creates properly typed errors following core error patterns
 *
 * TODO: Re-evaluate if these client errors are necessary. Since client-sdk is above the API layer,
 * these typed errors may not add much value compared to core errors. Consider simplifying or
 * removing these in favor of direct core error usage.
 */
export class ClientError {
    /**
     * Connection and Network Errors
     */
    static connectionFailed(baseUrl: string, originalError?: Error) {
        return new DextoRuntimeError(
            'agent_initialization_failed' as DextoErrorCode,
            ErrorScope.AGENT,
            ErrorType.THIRD_PARTY,
            `Failed to connect to Dexto server at ${baseUrl}`,
            { baseUrl, originalError: originalError?.message },
            'Check that the Dexto server is running and the baseUrl is correct'
        );
    }

    static networkError(message: string, originalError?: Error) {
        return new DextoRuntimeError(
            'mcp_connection_failed' as DextoErrorCode,
            ErrorScope.AGENT,
            ErrorType.THIRD_PARTY,
            message,
            { originalError: originalError?.message },
            'Check your network connection and server availability'
        );
    }

    static httpError(status: number, statusText: string, endpoint?: string, details?: unknown) {
        const errorType =
            status === 429
                ? ErrorType.RATE_LIMIT
                : status >= 500
                  ? ErrorType.THIRD_PARTY
                  : ErrorType.USER;

        return new DextoRuntimeError(
            'mcp_connection_failed' as DextoErrorCode,
            ErrorScope.AGENT,
            errorType,
            `HTTP ${status}: ${statusText}${endpoint ? ` (${endpoint})` : ''}`,
            { status, statusText, endpoint, details },
            status >= 500 ? 'Server error - try again later' : 'Check your request parameters'
        );
    }

    static timeoutError(operation: string, timeout: number) {
        return new DextoRuntimeError(
            'mcp_connection_failed' as DextoErrorCode,
            ErrorScope.AGENT,
            ErrorType.TIMEOUT,
            `Operation '${operation}' timed out after ${timeout}ms`,
            { operation, timeout },
            'Try increasing the timeout value or check server response time'
        );
    }

    /**
     * WebSocket Errors
     */
    static websocketConnectionFailed(url: string, originalError?: Error) {
        return new DextoRuntimeError(
            'mcp_connection_failed' as DextoErrorCode,
            ErrorScope.AGENT,
            ErrorType.THIRD_PARTY,
            `Failed to connect WebSocket to ${url}`,
            { url, originalError: originalError?.message },
            'Check WebSocket endpoint and network connectivity'
        );
    }

    static websocketSendFailed(originalError?: Error) {
        return new DextoRuntimeError(
            'mcp_connection_failed' as DextoErrorCode,
            ErrorScope.AGENT,
            ErrorType.SYSTEM,
            'Failed to send WebSocket message',
            { originalError: originalError?.message },
            'WebSocket connection may be closed - try reconnecting'
        );
    }

    /**
     * Validation Errors
     */
    static validationFailed(issues: Issue[]) {
        return new DextoValidationError(issues);
    }

    static invalidConfig(field: string, value: unknown, reason: string) {
        const issue: Issue = {
            code: 'agent_api_validation_error' as DextoErrorCode,
            message: `Invalid configuration for ${field}: ${reason}`,
            scope: ErrorScope.CONFIG,
            type: ErrorType.USER,
            severity: 'error',
            context: { field, value },
        };
        return new DextoValidationError([issue]);
    }

    static responseParseError(originalError?: Error) {
        return new DextoRuntimeError(
            'agent_api_validation_error' as DextoErrorCode,
            ErrorScope.AGENT,
            ErrorType.THIRD_PARTY,
            'Failed to parse server response',
            { originalError: originalError?.message },
            'The server returned an invalid response format'
        );
    }

    /**
     * Authentication Errors
     */
    static authenticationFailed(details?: unknown) {
        return new DextoRuntimeError(
            'agent_api_validation_error' as DextoErrorCode,
            ErrorScope.AGENT,
            ErrorType.USER,
            'Authentication failed',
            { details },
            'Check your API key and authentication credentials'
        );
    }

    static unauthorized(details?: unknown) {
        return new DextoRuntimeError(
            'agent_api_validation_error' as DextoErrorCode,
            ErrorScope.AGENT,
            ErrorType.FORBIDDEN,
            'Unauthorized access',
            { details },
            'You do not have permission to perform this action'
        );
    }

    static rateLimited(retryAfter?: number) {
        return new DextoRuntimeError(
            'agent_api_validation_error' as DextoErrorCode,
            ErrorScope.AGENT,
            ErrorType.RATE_LIMIT,
            'Rate limit exceeded',
            { retryAfter },
            retryAfter
                ? `Wait ${retryAfter} seconds before retrying`
                : 'Wait before making more requests'
        );
    }
}

// Re-export core error types for testing and user convenience
export { DextoRuntimeError, DextoValidationError } from '@dexto/core';
export type { Issue } from '@dexto/core';
