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
        if ('message' in error && typeof error.message === 'string') {
            return new Error(error.message);
        }
        if ('error' in error && typeof error.error === 'string') {
            return new Error(error.error);
        }
        if ('details' in error && typeof error.details === 'string') {
            return new Error(error.details);
        }
        if ('description' in error && typeof error.description === 'string') {
            return new Error(error.description);
        }

        // Fallback to safe serialization for complex objects
        const serialized = safeStringify(error); // Use default limit (1000 chars)
        return new Error(serialized);
    }

    if (typeof error === 'string') {
        return new Error(error);
    }

    // For primitives and other types
    return new Error(String(error));
}

/**
 * Extracts a meaningful error message string from any error value
 * Similar to toError but returns just the message string
 *
 * @param error - The error value to extract message from
 * @returns Meaningful error message string
 */
export function extractErrorMessage(error: unknown): string {
    return toError(error).message;
}
