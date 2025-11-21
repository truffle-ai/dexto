// Lightweight error handling - simple error classes without complex validation

/**
 * Simple error factory for client SDK
 * No complex validation - let server handle validation and return appropriate errors
 */
export class ClientError {
    /**
     * Connection and Network Errors
     */
    static connectionFailed(baseUrl: string, originalError?: Error) {
        const error = new Error(`Failed to connect to Dexto server at ${baseUrl}`);
        error.name = 'ConnectionError';
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
     * Configuration Errors
     */
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
}
