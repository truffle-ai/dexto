/**
 * Utility functions for converting various error types to proper Error instances
 * with meaningful messages instead of "[object Object]"
 */

import { safeStringify } from './safe-stringify.js';
import type { Logger } from '../logger/v2/types.js';

/**
 * Converts any error value to an Error instance with a meaningful message
 *
 * @param error - The error value to convert (can be Error, object, string, etc.)
 * @returns Error instance with extracted or serialized message
 */
export function toError(error: unknown, logger: Logger): Error {
    if (error instanceof Error) {
        logger.info(`error is already an Error: ${error.message}`);
        return error;
    }

    if (error && typeof error === 'object') {
        const errorObj = error as any;

        // Handle Vercel AI SDK error format: parse error.error.responseBody JSON
        // TODO: this is a workaround because vercel's ai sdk errors returned are untyped garbage
        // Summary: onError callback returns this weird shape. If we try to catch the promise.all block
        // we get a useless error (added comments near the catch block).
        // Improve this once vercel ai sdk errors are typed properly.

        // Handle Vercel AI SDK error format: error.error.data.error.message
        if (errorObj.error?.data?.error?.message) {
            logger.info(
                `Extracted error from error.error.data.error.message: ${errorObj.error.data.error.message}`
            );
            return new Error(errorObj.error.data.error.message, { cause: error });
        }

        if (errorObj.error?.responseBody && typeof errorObj.error.responseBody === 'string') {
            try {
                const parsed = JSON.parse(errorObj.error.responseBody);
                if (parsed?.error?.message) {
                    logger.info(
                        `Extracted error from error.error.responseBody: ${parsed.error.message}`
                    );
                    return new Error(parsed.error.message, { cause: error });
                }
            } catch {
                logger.info(`Failed to parse error.error.responseBody as JSON`);
                // Failed to parse, continue to other checks
            }
        }

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
        const serialized = safeStringify(error); // Uses truncation + circular-ref safety
        logger.info(`falling back to safe serialization for complex objects: ${serialized}`);
        return new Error(serialized);
    }

    if (typeof error === 'string') {
        return new Error(error, { cause: error });
    }

    // For primitives and other types
    return new Error(String(error), { cause: error as unknown });
}
