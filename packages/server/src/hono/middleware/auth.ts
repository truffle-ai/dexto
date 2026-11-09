import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { logger } from '@dexto/core';

/**
 * Authentication middleware for API security
 *
 * Security model:
 * 1. The server binds to loopback (127.0.0.1) unless a host is chosen explicitly.
 * 2. DEXTO_SERVER_API_KEY set: every protected request needs `Authorization: Bearer <key>`.
 * 3. NODE_ENV=production or DEXTO_SERVER_REQUIRE_AUTH=true without a key: protected requests
 *    fail closed with a configuration error.
 * 4. No key and neither flag: no auth (loopback development only). Binding to any
 *    non-loopback host without a key is refused at startup (see assertNetworkBindAllowed).
 * 5. Public routes (health check, A2A discovery) are always accessible.
 *
 * Usage:
 * Development (default):
 *   dexto --mode server            # loopback only, no auth
 *
 * Network-facing:
 *   DEXTO_SERVER_API_KEY=your-key dexto --mode server --host 0.0.0.0
 *   Clients must send: Authorization: Bearer <DEXTO_SERVER_API_KEY>
 */

/** Default bind address for Dexto HTTP servers. */
export const DEFAULT_SERVER_HOSTNAME = '127.0.0.1';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1']);

/** True only for literal loopback addresses. Hostnames (including `localhost`) are not trusted. */
export function isLoopbackHost(host: string): boolean {
    const normalized = host
        .trim()
        .toLowerCase()
        .replace(/^\[(.*)\]$/, '$1');
    return LOOPBACK_HOSTS.has(normalized);
}

/** The bind host: an explicit value, else DEXTO_SERVER_HOST, else loopback. */
export function resolveServerHostname(explicit?: string): string {
    const fromEnv = process.env.DEXTO_SERVER_HOST?.trim();
    return explicit?.trim() || fromEnv || DEFAULT_SERVER_HOSTNAME;
}

function configuredApiKey(): string | undefined {
    // Trim so a key read from a mounted secret with a trailing newline still matches.
    const apiKey = process.env.DEXTO_SERVER_API_KEY?.trim();
    return apiKey ? apiKey : undefined;
}

function keysMatch(provided: string, expected: string): boolean {
    const providedBuffer = Buffer.from(provided);
    const expectedBuffer = Buffer.from(expected);
    return (
        providedBuffer.length === expectedBuffer.length &&
        timingSafeEqual(providedBuffer, expectedBuffer)
    );
}

/** Keys shorter than this still work, but startup warns that they are easy to guess. */
const MIN_RECOMMENDED_KEY_LENGTH = 16;

/**
 * Refuse to listen on a non-loopback host unless a bearer credential is configured, or the
 * caller explicitly disabled built-in auth because an external auth layer is in front.
 */
export function assertNetworkBindAllowed(
    hostname: string,
    options: { authDisabled?: boolean } = {}
): void {
    if (isLoopbackHost(hostname) || options.authDisabled) {
        return;
    }
    const apiKey = configuredApiKey();
    if (apiKey) {
        if (apiKey.length < MIN_RECOMMENDED_KEY_LENGTH) {
            logger.warn(
                `DEXTO_SERVER_API_KEY is shorter than ${MIN_RECOMMENDED_KEY_LENGTH} characters; use a long random key for a network-facing server.`
            );
        }
        return;
    }
    throw new Error(
        `Refusing to listen on ${hostname} without authentication. Set DEXTO_SERVER_API_KEY to require a bearer token, or bind to 127.0.0.1.`
    );
}

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
        const providedKey = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
        if (!providedKey || !keysMatch(providedKey, apiKey)) {
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
    const apiKey = configuredApiKey();
    const isProduction = process.env.NODE_ENV === 'production';
    const requireAuth = process.env.DEXTO_SERVER_REQUIRE_AUTH === 'true';
    if (!apiKey && !isProduction && !requireAuth) return () => ({ allowed: true });
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
