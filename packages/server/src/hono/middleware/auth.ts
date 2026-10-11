import type { MiddlewareHandler } from 'hono';
import { logger } from '@dexto/core';

/**
 * Authentication middleware for API security
 *
 * Security model:
 * 1. Default (no env): Development mode - no auth required
 * 2. NODE_ENV=production: Production mode - auth required
 * 3. DEXTO_SERVER_REQUIRE_AUTH=true: Explicit auth enforcement
 * 4. Public routes (health check, A2A discovery) are always accessible
 *
 * Usage:
 * Development (default):
 *   npm start  # No auth needed, existing scripts work
 *
 * Production:
 *   DEXTO_SERVER_API_KEY=your-key NODE_ENV=production npm start
 *   Clients must send: Authorization: Bearer <DEXTO_SERVER_API_KEY>
 */

const PUBLIC_ROUTES = ['/health', '/.well-known/agent-card.json', '/openapi.json'];

export type HttpAuthorizationResult =
    | { allowed: true }
    | { allowed: false; status: 401 | 500; body: { error: string; message: string } };

export type HttpAuthorization = (header: string | undefined) => HttpAuthorizationResult;

/** Required bearer validation, independent of the development-mode server default. */
export function createRequiredBearerAuthorization(
    apiKey: string | undefined,
    configurationMessage = 'Server API key not configured.'
): HttpAuthorization {
    return (header) => {
        if (!apiKey) {
            return {
                allowed: false,
                status: 500,
                body: { error: 'Configuration Error', message: configurationMessage },
            };
        }
        const providedKey = header?.match(/^Bearer\s+(.+)$/i)?.[1];
        if (!providedKey || providedKey !== apiKey) {
            return {
                allowed: false,
                status: 401,
                body: {
                    error: 'Unauthorized',
                    message:
                        'Invalid or missing API key. Provide Authorization: Bearer <api-key> header.',
                },
            };
        }
        return { allowed: true };
    };
}

export function createHttpAuthorization(): HttpAuthorization {
    const apiKey = process.env.DEXTO_SERVER_API_KEY;
    const isProduction = process.env.NODE_ENV === 'production';
    const requireAuth = process.env.DEXTO_SERVER_REQUIRE_AUTH === 'true';
    if (!isProduction && !requireAuth) return () => ({ allowed: true });
    if (isProduction && !apiKey) {
        logger.warn(
            'Production HTTP authentication requires DEXTO_SERVER_API_KEY; protected requests will fail closed.'
        );
    }
    return createRequiredBearerAuthorization(
        apiKey,
        requireAuth
            ? 'DEXTO_SERVER_REQUIRE_AUTH=true but DEXTO_SERVER_API_KEY not set. Set DEXTO_SERVER_API_KEY environment variable.'
            : 'NODE_ENV=production requires DEXTO_SERVER_API_KEY. Set DEXTO_SERVER_API_KEY environment variable to secure your API.'
    );
}

export function createAuthMiddleware(
    authorize: HttpAuthorization = createHttpAuthorization()
): MiddlewareHandler {
    return async (ctx, next) => {
        const path = ctx.req.path;
        if (PUBLIC_ROUTES.some((route) => path === route || path.startsWith(route))) {
            return next();
        }
        const result = authorize(ctx.req.header('Authorization'));
        if (!result.allowed) {
            if (result.status === 401) logger.warn('Unauthorized API access attempt', { path });
            return ctx.json(result.body, result.status);
        }
        await next();
    };
}
