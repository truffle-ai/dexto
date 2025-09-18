import type { MiddlewareHandler } from 'hono';
import type { Context } from 'hono';
import {
    DextoRuntimeError,
    DextoValidationError,
    ErrorType,
    zodToIssues,
    logger,
} from '@dexto/core';
import { ZodError } from 'zod';
import { sendJson } from '../utils/response.js';

export const mapErrorTypeToStatus = (type: ErrorType): number => {
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

export const statusForValidation = (issues: ReturnType<typeof zodToIssues>): number => {
    const firstError = issues.find((i) => i.severity === 'error');
    const type = firstError?.type ?? ErrorType.USER;
    return mapErrorTypeToStatus(type);
};

export function handleHonoError(ctx: Context, err: unknown) {
    if (err instanceof DextoRuntimeError) {
        return sendJson(ctx, err.toJSON(), mapErrorTypeToStatus(err.type));
    }

    if (err instanceof DextoValidationError) {
        return sendJson(ctx, err.toJSON(), statusForValidation(err.issues));
    }

    if (err instanceof ZodError) {
        const issues = zodToIssues(err);
        const dexErr = new DextoValidationError(issues);
        return sendJson(ctx, dexErr.toJSON(), statusForValidation(issues));
    }

    // Some handlers (e.g., ctx.req.json()) may throw SyntaxError for invalid/empty JSON
    if (err instanceof SyntaxError) {
        return sendJson(
            ctx,
            {
                code: 'invalid_json',
                message: err.message || 'Invalid JSON body',
                scope: 'agent',
                type: 'user',
                severity: 'error',
            },
            400
        );
    }

    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : undefined;
    logger.error(`Unhandled error in API middleware: ${errorMessage}`, {
        error: err,
        stack: errorStack,
        type: typeof err,
    });

    return sendJson(
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

export const errorMiddleware: MiddlewareHandler = async (ctx, next) => {
    try {
        await next();
        return;
    } catch (err) {
        return handleHonoError(ctx, err);
    }
};
