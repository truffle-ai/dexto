import type { Request, Response, NextFunction } from 'express';
import { DextoError } from '@core/error/DextoError.js';
import { ErrorType } from '@core/error/types.js';
import { logger } from '@core/logger/index.js';

/**
 * Maps ErrorType to HTTP status codes
 * Clean 1:1 mapping without special cases
 */
const statusFor = (err: DextoError): number => {
    switch (err.type) {
        case ErrorType.USER:
            return 400;
        case ErrorType.NOT_FOUND:
            return 404;
        case ErrorType.FORBIDDEN:
            return 403;
        case ErrorType.TIMEOUT:
            return 408;
        case ErrorType.RATE_LIMIT:
            return 429;
        case ErrorType.SYSTEM:
            return 500;
        case ErrorType.THIRD_PARTY:
            return 502;
        default:
            return 500;
    }
};

/**
 * Express error middleware for handling DextoError instances
 * Provides consistent error responses across all API endpoints
 */
export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction): void {
    if (err instanceof DextoError) {
        const status = statusFor(err);
        res.status(status).json(err.toJSON());
        return;
    }

    // Log unexpected errors for debugging
    logger.error(`Unhandled error: ${err}`);

    // Generic error response for non-DextoError exceptions
    res.status(500).json({
        code: 'internal_error',
        message: 'An unexpected error occurred',
        scope: 'system',
        type: 'system',
        severity: 'error',
    });
}
