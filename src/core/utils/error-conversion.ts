/**
 * Utility functions for converting various error types to proper Error instances
 * with meaningful messages instead of "[object Object]"
 */

import { safeStringify } from './safe-stringify.js';

/**
 * Converts any error value to an Error instance with a meaningful message
 *
 * @param error - The error value to convert (can be Error, object, string, etc.)
 * @returns Error instance with extracted or serialized message
 */
export function toError(error: unknown): Error {
    if (error instanceof Error) {
        return error;
    }

    if (error && typeof error === 'object') {
        // Try to extract meaningful message from error object
        if ('message' in error && typeof (error as { message?: unknown }).message === 'string') {
            return new Error((error as { message: string }).message, { cause: error });
        }
        if ('error' in error && typeof (error as { error?: unknown }).error === 'string') {
            return new Error((error as { error: string }).error, { cause: error });
        }
        if ('details' in error && typeof (error as { details?: unknown }).details === 'string') {
            return new Error((error as { details: string }).details, { cause: error });
        }
        if (
            'description' in error &&
            typeof (error as { description?: unknown }).description === 'string'
        ) {
            return new Error((error as { description: string }).description, { cause: error });
        }

        // Fallback to safe serialization for complex objects
        const serialized = safeStringify(error); // Use default limit (1000 chars)
        return new Error(serialized);
    }

    if (typeof error === 'string') {
        return new Error(error, { cause: error });
    }

    // For primitives and other types
    return new Error(String(error), { cause: error as unknown });
}
