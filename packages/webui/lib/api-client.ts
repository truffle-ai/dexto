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

/**
 * Custom error class for API errors
 * Provides structured error information including status code and response data
 */
export class ApiError extends Error {
    constructor(
        message: string,
        public status: number,
        public data?: unknown
    ) {
        super(message);
        this.name = 'ApiError';
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

        // Extract error message from response
        const errorMessage =
            (errorData as any)?.error ||
            (errorData as any)?.message ||
            `HTTP ${response.status} ${response.statusText}`;

        throw new ApiError(errorMessage, response.status, errorData);
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
            text
        );
    }
}
