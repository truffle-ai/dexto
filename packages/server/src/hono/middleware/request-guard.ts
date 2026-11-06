import type { MiddlewareHandler } from 'hono';
import { logger } from '@dexto/core';

/**
 * Browser-facing request checks for the Dexto HTTP API.
 *
 * CORS only controls whether a browser may *read* a cross-origin response; it does not stop
 * the request from reaching the server. These checks reject requests a browser page on
 * another site could send:
 *
 * 1. State-changing methods (POST, PUT, PATCH, DELETE):
 *    - an `Origin` header, when present, must be an allowed origin (loopback, or listed in
 *      DEXTO_ALLOWED_ORIGINS); `Origin: null` is rejected;
 *    - `Sec-Fetch-Site: cross-site` is rejected;
 *    - the request must carry a header a browser cannot send cross-origin without a CORS
 *      preflight: `Authorization`, `X-Dexto-Request`, or a non-simple `Content-Type`
 *      (for example `application/json`).
 * 2. When the server runs without authentication (loopback development), every request must
 *    name a loopback host in its `Host` header (or one listed in DEXTO_ALLOWED_HOSTS). This
 *    blocks DNS-rebinding pages, whose requests carry the attacker's hostname.
 */

/** Header the Dexto clients send on every request to mark it as non-simple. */
export const DEXTO_REQUEST_HEADER = 'X-Dexto-Request';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const SIMPLE_CONTENT_TYPES = new Set([
    'application/x-www-form-urlencoded',
    'multipart/form-data',
    'text/plain',
]);

export type RequestGuardOptions = {
    /** Require a loopback (or DEXTO_ALLOWED_HOSTS) `Host` header on every request. */
    enforceLoopbackHost: boolean;
};

export type RequestGuardResult = { allowed: true } | { allowed: false; reason: string };

export type RequestGuard = (request: {
    method: string;
    header: (name: string) => string | undefined;
}) => RequestGuardResult;

function listFromEnv(name: string): string[] {
    return (process.env[name] ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
}

/** Origins allowed to call the API from a browser: loopback, plus DEXTO_ALLOWED_ORIGINS. */
export function isAllowedRequestOrigin(origin: string): boolean {
    let url: URL;
    try {
        url = new URL(origin);
    } catch {
        return false;
    }
    if (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        LOOPBACK_HOSTNAMES.has(url.hostname)
    ) {
        return true;
    }
    return listFromEnv('DEXTO_ALLOWED_ORIGINS').includes(origin);
}

/** True when a `Host` header names loopback (any port) or an entry of DEXTO_ALLOWED_HOSTS. */
export function isAllowedHostHeader(host: string | undefined): boolean {
    if (!host) {
        return false;
    }
    let hostname: string;
    try {
        hostname = new URL(`http://${host}`).hostname;
    } catch {
        return false;
    }
    if (LOOPBACK_HOSTNAMES.has(hostname)) {
        return true;
    }
    const allowed = listFromEnv('DEXTO_ALLOWED_HOSTS').map((entry) => entry.toLowerCase());
    return allowed.includes(host.toLowerCase()) || allowed.includes(hostname);
}

function hasNonSimpleSignal(header: (name: string) => string | undefined): boolean {
    if (header('authorization') || header(DEXTO_REQUEST_HEADER.toLowerCase())) {
        return true;
    }
    const contentType = header('content-type');
    if (!contentType) {
        return false;
    }
    const mediaType = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
    return mediaType.length > 0 && !SIMPLE_CONTENT_TYPES.has(mediaType);
}

export function createRequestGuard(options: RequestGuardOptions): RequestGuard {
    return ({ method, header }) => {
        if (options.enforceLoopbackHost && !isAllowedHostHeader(header('host'))) {
            return { allowed: false, reason: 'Host header is not allowed' };
        }

        if (!STATE_CHANGING_METHODS.has(method.toUpperCase())) {
            return { allowed: true };
        }

        const origin = header('origin');
        if (origin !== undefined && !isAllowedRequestOrigin(origin)) {
            return { allowed: false, reason: 'Origin is not allowed' };
        }
        if (header('sec-fetch-site')?.toLowerCase() === 'cross-site') {
            return { allowed: false, reason: 'Cross-site request' };
        }
        if (!hasNonSimpleSignal(header)) {
            return {
                allowed: false,
                reason: `State-changing requests must send ${DEXTO_REQUEST_HEADER}, Authorization, or a JSON Content-Type`,
            };
        }
        return { allowed: true };
    };
}

export function createRequestGuardMiddleware(guard: RequestGuard): MiddlewareHandler {
    return async (ctx, next) => {
        if (ctx.req.method === 'OPTIONS') {
            return next();
        }
        const result = guard({
            method: ctx.req.method,
            header: (name) => ctx.req.header(name),
        });
        if (!result.allowed) {
            logger.warn('Rejected request by origin/host guard', {
                path: ctx.req.path,
                reason: result.reason,
            });
            return ctx.json({ error: 'Forbidden', message: result.reason }, 403);
        }
        await next();
    };
}
