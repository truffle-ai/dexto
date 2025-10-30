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

const PUBLIC_ROUTES = ['/health', '/.well-known/agent.json', '/openapi.json'];

export function createAuthMiddleware(): MiddlewareHandler {
    const apiKey = process.env.DEXTO_SERVER_API_KEY;
    const isProduction = process.env.NODE_ENV === 'production';
    const requireAuth = process.env.DEXTO_SERVER_REQUIRE_AUTH === 'true'; // Explicit opt-in

    // Log security configuration on startup
    if (isProduction && !apiKey) {
        logger.warn(
            '⚠️  SECURITY WARNING: Running in production mode (NODE_ENV=production) without DEXTO_SERVER_API_KEY. ' +
                'Dexto Server API is UNPROTECTED. Set DEXTO_SERVER_API_KEY environment variable to secure your API.'
        );
    }

    return async (ctx, next) => {
        const path = ctx.req.path;

        // Always allow public routes
        if (PUBLIC_ROUTES.some((route) => path === route || path.startsWith(route))) {
            return next();
        }

        // Default behavior: Development mode (no auth required)
        // This ensures existing dev scripts don't break
        if (!isProduction && !requireAuth) {
            return next();
        }

        // Production mode or explicit DEXTO_SERVER_REQUIRE_AUTH=true
        // Requires API key to be set
        if (!apiKey) {
            if (requireAuth) {
                return ctx.json(
                    {
                        error: 'Configuration Error',
                        message:
                            'DEXTO_SERVER_REQUIRE_AUTH=true but DEXTO_SERVER_API_KEY not set. Set DEXTO_SERVER_API_KEY environment variable.',
                    },
                    500
                );
            }

            // Production without API key - allow but already warned above
            return next();
        }

        // API key is set - validate it
        const authHeader = ctx.req.header('Authorization');
        const providedKey = authHeader?.replace(/^Bearer\s+/i, '');

        if (!providedKey || providedKey !== apiKey) {
            logger.warn('Unauthorized API access attempt', {
                path,
                hasKey: !!providedKey,
                origin: ctx.req.header('origin'),
                userAgent: ctx.req.header('user-agent'),
            });

            return ctx.json(
                {
                    error: 'Unauthorized',
                    message:
                        'Invalid or missing API key. Provide Authorization: Bearer <api-key> header.',
                },
                401
            );
        }

        // Valid API key - proceed
        await next();
    };
}
