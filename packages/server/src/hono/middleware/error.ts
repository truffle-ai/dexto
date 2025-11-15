import { DextoRuntimeError, DextoValidationError, ErrorType, zodToIssues } from '@dexto/core';
import { logger } from '@dexto/core';
import { ZodError } from 'zod';

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

export function handleHonoError(ctx: any, err: unknown) {
    if (err instanceof DextoRuntimeError) {
        return ctx.json(err.toJSON(), mapErrorTypeToStatus(err.type));
    }

    if (err instanceof DextoValidationError) {
        return ctx.json(err.toJSON(), statusForValidation(err.issues));
    }

    if (err instanceof ZodError) {
        const issues = zodToIssues(err);
        const dexErr = new DextoValidationError(issues);
        return ctx.json(dexErr.toJSON(), statusForValidation(issues));
    }

    // Some hono specific handlers (e.g., ctx.req.json()) may throw SyntaxError for invalid/empty JSON
    if (err instanceof SyntaxError) {
        return ctx.json(
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
        stack: errorStack,
        type: typeof err,
    });

    // Only expose error details in development, use generic message in production
    const isDevelopment = process.env.NODE_ENV === 'development';
    const userMessage = isDevelopment
        ? `An unexpected error occurred: ${errorMessage}`
        : 'An unexpected error occurred. Please try again later.';

    return ctx.json(
        {
            code: 'internal_error',
            message: userMessage,
            scope: 'system',
            type: 'system',
            severity: 'error',
            // Only include stack traces in development to avoid exposing internals
            ...(isDevelopment && errorStack ? { stack: errorStack } : {}),
        },
        500
    );
}
