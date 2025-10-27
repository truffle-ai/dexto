import type { Request, Response, NextFunction } from 'express';
import { DextoRuntimeError, DextoValidationError, ErrorType, type Issue } from '@dexto/core';
import { ZodError } from 'zod';
import { zodToIssues, logger } from '@dexto/core';

/**
 * Single mapping from ErrorType to HTTP status code
 */
const mapErrorTypeToStatus = (type: ErrorType): number => {
    switch (type) {
        case ErrorType.USER:
            return 400;
        case ErrorType.NOT_FOUND:
            return 404;
        case ErrorType.FORBIDDEN:
            return 403;
        case ErrorType.TIMEOUT:
            return 408;
        case ErrorType.CONFLICT:
            return 409;
        case ErrorType.RATE_LIMIT:
            return 429;
        case ErrorType.SYSTEM:
            return 500;
        case ErrorType.THIRD_PARTY:
            return 502;
        case ErrorType.UNKNOWN:
        default:
            return 500;
    }
};

/**
 * Map validation issues to HTTP status, based on the most relevant Issue.type
 * Defaults to 400 for unknown/missing types
 */
const statusForValidation = (issues: Issue[]): number => {
    const firstError = issues.find((i) => i.severity === 'error');
    const type = firstError?.type ?? ErrorType.USER;
    return mapErrorTypeToStatus(type);
};

/**
 * Express error middleware for handling DextoError instances
 * Provides consistent error responses across all API endpoints
 */
export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction): void {
    if (err instanceof DextoRuntimeError) {
        const status = mapErrorTypeToStatus(err.type);
        res.status(status).json(err.toJSON());
        return;
    }

    if (err instanceof DextoValidationError) {
        const status = statusForValidation(err.issues);
        res.status(status).json(err.toJSON());
        return;
    }

    // Handle raw Zod errors defensively by converting to our validation error
    if (err instanceof ZodError) {
        const issues = zodToIssues(err);
        const dexErr = new DextoValidationError(issues);
        const status = statusForValidation(issues);
        res.status(status).json(dexErr.toJSON());
        return;
    }

    // Log unexpected errors with full context for debugging
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : undefined;
    logger.error(`Unhandled error in API middleware: ${errorMessage}`, {
        error: err,
        stack: errorStack,
        type: typeof err,
    });

    // Generic error response for non-DextoError exceptions
    res.status(500).json({
        code: 'internal_error',
        message: 'An unexpected error occurred',
        scope: 'system',
        type: 'system',
        severity: 'error',
    });
}
