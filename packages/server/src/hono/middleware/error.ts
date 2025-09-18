import type { MiddlewareHandler } from 'hono';
import {
    DextoRuntimeError,
    DextoValidationError,
    ErrorType,
    zodToIssues,
    logger,
} from '@dexto/core';
import { ZodError } from 'zod';
import { sendJson } from '../utils/response.js';

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

const statusForValidation = (issues: ReturnType<typeof zodToIssues>): number => {
    const firstError = issues.find((i) => i.severity === 'error');
    const type = firstError?.type ?? ErrorType.USER;
    return mapErrorTypeToStatus(type);
};

export const errorMiddleware: MiddlewareHandler = async (ctx, next) => {
    try {
        await next();
        return;
    } catch (err) {
        if (err instanceof DextoRuntimeError) {
            sendJson(ctx, err.toJSON(), mapErrorTypeToStatus(err.type));
            return;
        }

        if (err instanceof DextoValidationError) {
            sendJson(ctx, err.toJSON(), statusForValidation(err.issues));
            return;
        }

        if (err instanceof ZodError) {
            const issues = zodToIssues(err);
            const dexErr = new DextoValidationError(issues);
            sendJson(ctx, dexErr.toJSON(), statusForValidation(issues));
            return;
        }

        const errorMessage = err instanceof Error ? err.message : String(err);
        const errorStack = err instanceof Error ? err.stack : undefined;
        logger.error(`Unhandled error in API middleware: ${errorMessage}`, {
            error: err,
            stack: errorStack,
            type: typeof err,
        });

        sendJson(
            ctx,
            {
                code: 'internal_error',
                message: 'An unexpected error occurred',
                scope: 'system',
                type: 'system',
                severity: 'error',
            },
            500
        );
    }
};
