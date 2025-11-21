/**
 * Centralized API client for making HTTP requests
 *
 * Benefits:
 * - Consistent error handling across all API calls
 * - Automatic JSON parsing with proper error messages
 * - Type-safe responses with TypeScript generics
 * - Reduces boilerplate in queryFn functions
 *
 * Usage:
 * - apiFetch<User>('/api/users/123')
 * - apiFetch<User[]>('/api/users', { method: 'GET' })
 * - apiFetch<void>('/api/users/123', { method: 'DELETE' })
 */

import { getApiUrl } from './api-url';
import { extractErrorMessage, extractErrorDetails, type DextoErrorResponse } from './api-errors.js';

/**
 * Custom error class for API errors
 * Provides structured error information including status code and response data
 *
 * The error message automatically includes endpoint context for better debugging.
 * Access the original message without endpoint via the `originalMessage` property.
 */
export class ApiError extends Error {
    public readonly code?: string;
    public readonly scope?: string;
    public readonly type?: string;
    public readonly traceId?: string;
    public readonly recovery?: string | string[];
    public readonly endpoint: string;
    public readonly method: string;
    public readonly originalMessage: string;

    constructor(
        message: string,
        public status: number,
        endpoint: string,
        method: string,
        public data?: unknown
    ) {
        // Store original message before augmenting it
        const originalMsg = message;

        // Extract additional error details if available
        let finalEndpoint = endpoint;
        let finalMethod = method;

        if (data && typeof data === 'object') {
            const details = extractErrorDetails(data as Partial<DextoErrorResponse>);
            // Prefer endpoint/method from server response if available
            finalEndpoint = details.endpoint || endpoint;
            finalMethod = details.method || method;
        }

        // Format endpoint info for display
        const endpointInfo = `${finalMethod.toUpperCase()} ${finalEndpoint}`;

        // Augment message with endpoint context automatically
        super(`${message} (${endpointInfo})`);

        this.name = 'ApiError';
        this.originalMessage = originalMsg;
        this.endpoint = finalEndpoint;
        this.method = finalMethod;

        // Extract additional error details
        if (data && typeof data === 'object') {
            const details = extractErrorDetails(data as Partial<DextoErrorResponse>);
            this.code = details.code;
            this.scope = details.scope;
            this.type = details.type;
            this.traceId = details.traceId;
            this.recovery = details.recovery;
        }
    }

    /**
     * Get formatted endpoint info for display
     * @returns Formatted string like "POST /api/llm/switch"
     */
    getEndpointInfo(): string {
        return `${this.method.toUpperCase()} ${this.endpoint}`;
    }
}

/**
 * Centralized fetch wrapper for API requests
 *
 * @param endpoint - API endpoint path (e.g., '/api/users')
 * @param options - Standard fetch options (method, headers, body, etc.)
 * @returns Parsed JSON response of type T
 * @throws {ApiError} When the response is not ok
 *
 * @example
 * ```ts
 * // GET request
 * const users = await apiFetch<User[]>('/api/users');
 *
 * // POST request
 * const newUser = await apiFetch<User>('/api/users', {
 *   method: 'POST',
 *   body: JSON.stringify({ name: 'Alice' }),
 * });
 *
 * // DELETE request
 * await apiFetch<void>('/api/users/123', { method: 'DELETE' });
 * ```
 */
export async function apiFetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const url = `${getApiUrl()}${endpoint}`;
    const method = options?.method || 'GET';

    const response = await fetch(url, {
        headers: {
            'Content-Type': 'application/json',
            ...options?.headers,
        },
        ...options,
    });

    if (!response.ok) {
        // Try to parse error response
        let errorData: unknown;
        try {
            errorData = await response.json();
        } catch {
            errorData = null;
        }

        // Extract the most specific error message using our utility
        const errorMessage = extractErrorMessage(
            (errorData as Partial<DextoErrorResponse>) || {},
            `HTTP ${response.status} ${response.statusText}`
        );

        throw new ApiError(errorMessage, response.status, endpoint, method, errorData);
    }

    // Handle empty responses
    const text = await response.text();
    if (!text || text.trim() === '') {
        return null as T;
    }

    // Parse JSON response
    try {
        return JSON.parse(text) as T;
    } catch (error) {
        throw new ApiError(
            `Failed to parse JSON response: ${error instanceof Error ? error.message : 'Unknown error'}`,
            response.status,
            endpoint,
            method,
            text
        );
    }
}
