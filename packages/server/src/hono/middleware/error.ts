import { DextoRuntimeError, DextoValidationError, zodToIssues } from '@dexto/core';
import type { ErrorType } from '@dexto/core';
import { logger } from '@dexto/core';
import { ZodError } from 'zod';

// TODO: Standardize error responses across all server routes.
// Currently, routes use inconsistent error response formats:
// - Some throw typed errors (approvals.ts, prompts.ts) → middleware handles → standard format
// - Others return ad-hoc shapes like { error: '...' } or { ok: false, error: '...' }
//   (mcp.ts, webhooks.ts, sessions.ts, queue.ts, a2a-tasks.ts)
//
// Target: All routes should throw DextoRuntimeError/DextoValidationError for errors,
// letting this middleware handle conversion to the standard response format.
// See also: packages/server/src/hono/schemas/responses.ts for OpenAPI schema limitations.

export const mapErrorTypeToStatus = (type: ErrorType): number => {
    switch (type) {
        case 'user':
            return 400;
        case 'payment_required':
            return 402;
        case 'forbidden':
            return 403;
        case 'not_found':
            return 404;
        case 'timeout':
            return 408;
        case 'conflict':
            return 409;
        case 'rate_limit':
            return 429;
        case 'system':
            return 500;
        case 'third_party':
            return 502;
        case 'unknown':
        default:
            return 500;
    }
};

export const statusForValidation = (issues: ReturnType<typeof zodToIssues>): number => {
    const firstError = issues.find((i) => i.severity === 'error');
    const type = firstError?.type ?? 'user';
    return mapErrorTypeToStatus(type);
};

export function handleHonoError(ctx: any, err: unknown) {
    // Extract endpoint information for better error context
    const endpoint = ctx.req.path || 'unknown';
    const method = ctx.req.method || 'unknown';

    if (err instanceof DextoRuntimeError) {
        return ctx.json(
            {
                ...err.toJSON(),
                endpoint,
                method,
            },
            mapErrorTypeToStatus(err.type)
        );
    }

    if (err instanceof DextoValidationError) {
        return ctx.json(
            {
                ...err.toJSON(),
                endpoint,
                method,
            },
            statusForValidation(err.issues)
        );
    }

    if (err instanceof ZodError) {
        const issues = zodToIssues(err);
        const dexErr = new DextoValidationError(issues);
        return ctx.json(
            {
                ...dexErr.toJSON(),
                endpoint,
                method,
            },
            statusForValidation(issues)
        );
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
                endpoint,
                method,
            },
            400
        );
    }

    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : undefined;
    logger.error(
        `Unhandled error in API middleware: ${errorMessage}, endpoint: ${method} ${endpoint}, stack: ${errorStack}, type: ${typeof err}`
    );

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
            endpoint,
            method,
            // Only include stack traces in development to avoid exposing internals
            ...(isDevelopment && errorStack ? { stack: errorStack } : {}),
        },
        500
    );
}
