import { ErrorScope, ErrorType } from '@dexto/core';
import type { Issue, DextoErrorCode } from '@dexto/core';

/**
 * Client SDK error factory
 * Creates simple, browser-compatible errors without Node.js dependencies
 *
 * Why we don't use DextoRuntimeError/DextoValidationError:
 * - They have Node.js dependencies (crypto.randomUUID)
 * - They're overkill for client SDK users who just want simple error messages
 * - They add unnecessary complexity and bundle size
 * - Standard Error class works perfectly for client use cases
 */
export class ClientError {
    /**
     * Connection and Network Errors
     */
    static connectionFailed(baseUrl: string, originalError?: Error) {
        const error = new Error(`Failed to connect to Dexto server at ${baseUrl}`);
        error.name = 'ConnectionError';
        // Add helpful context for debugging
        (error as any).baseUrl = baseUrl;
        (error as any).originalError = originalError?.message;
        return error;
    }

    static networkError(message: string, originalError?: Error) {
        const error = new Error(`Network error: ${message}`);
        error.name = 'NetworkError';
        (error as any).originalError = originalError?.message;
        return error;
    }

    static httpError(status: number, statusText: string, endpoint?: string, details?: unknown) {
        const error = new Error(`HTTP ${status}: ${statusText}${endpoint ? ` (${endpoint})` : ''}`);
        error.name = 'HttpError';
        (error as any).status = status;
        (error as any).statusText = statusText;
        (error as any).endpoint = endpoint;
        (error as any).details = details;
        return error;
    }

    static timeoutError(operation: string, timeout: number) {
        const error = new Error(`Operation '${operation}' timed out after ${timeout}ms`);
        error.name = 'TimeoutError';
        (error as any).operation = operation;
        (error as any).timeout = timeout;
        return error;
    }

    /**
     * WebSocket Errors
     */
    static websocketConnectionFailed(url: string, originalError?: Error) {
        const error = new Error(`Failed to connect WebSocket to ${url}`);
        error.name = 'WebSocketConnectionError';
        (error as any).url = url;
        (error as any).originalError = originalError?.message;
        return error;
    }

    static websocketSendFailed(originalError?: Error) {
        const error = new Error('Failed to send WebSocket message');
        error.name = 'WebSocketSendError';
        (error as any).originalError = originalError?.message;
        return error;
    }

    /**
     * Validation Errors
     */
    static validationFailed(issues: Issue[]) {
        const error = new Error(`Validation failed: ${issues.map((i) => i.message).join(', ')}`);
        error.name = 'ValidationError';
        (error as any).issues = issues;
        return error;
    }

    static invalidConfig(field: string, value: unknown, reason: string) {
        const error = new Error(`Invalid configuration for ${field}: ${reason}`);
        error.name = 'InvalidConfigError';
        (error as any).field = field;
        (error as any).value = value;
        (error as any).reason = reason;
        return error;
    }

    static responseParseError(originalError?: Error) {
        const error = new Error('Failed to parse server response');
        error.name = 'ResponseParseError';
        (error as any).originalError = originalError?.message;
        return error;
    }

    /**
     * Authentication Errors
     */
    static authenticationFailed(details?: unknown) {
        const error = new Error('Authentication failed');
        error.name = 'AuthenticationError';
        (error as any).details = details;
        return error;
    }

    static unauthorized(details?: unknown) {
        const error = new Error('Unauthorized access');
        error.name = 'UnauthorizedError';
        (error as any).details = details;
        return error;
    }

    static rateLimited(retryAfter?: number) {
        const error = new Error('Rate limit exceeded');
        error.name = 'RateLimitError';
        (error as any).retryAfter = retryAfter;
        return error;
    }
}

// Re-export only the types that are actually used
export type { Issue } from '@dexto/core';
