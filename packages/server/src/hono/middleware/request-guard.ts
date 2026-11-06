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
 *    - an `Origin` header, when present, must be an allowed origin (loopback, listed in
 *      DEXTO_ALLOWED_ORIGINS, or the request's own `Host`); `Origin: null` is rejected;
 *    - `Sec-Fetch-Site: cross-site` is rejected;
 *    - the request must carry a header a browser cannot send cross-origin without a CORS
 *      preflight: `Authorization`, `X-Dexto-Request`, or a non-simple `Content-Type`
 *      (for example `application/json`).
 * 2. When the server runs without authentication (no API key, not production, no
 *    DEXTO_SERVER_REQUIRE_AUTH, built-in auth not disabled), every request must name a loopback
 *    address in its `Host` header (or one listed in DEXTO_ALLOWED_HOSTS). This
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

/**
 * True for literal loopback / unspecified addresses. DNS-rebinding requests always carry the
 * attacker's DNS name in `Host`, so literal IPs here are safe to accept.
 */
function isLoopbackLiteral(hostname: string): boolean {
    if (LOOPBACK_HOSTNAMES.has(hostname) || hostname === '0.0.0.0') {
        return true;
    }
    // The WHATWG URL parser normalizes IPv4 forms (127.1, 0x7f000001) to dotted decimal.
    return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
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
    if (isLoopbackLiteral(hostname)) {
        return true;
    }
    const allowed = listFromEnv('DEXTO_ALLOWED_HOSTS').map((entry) => entry.toLowerCase());
    return allowed.includes(host.toLowerCase()) || allowed.includes(hostname);
}

/**
 * A page served by this server (for example the Web UI behind a proxy or an external auth
 * layer) sends its own origin. Accept an Origin whose host matches the request's `Host`.
 * Without auth the Host itself has already been checked, so this cannot admit a rebinding page.
 */
function isSameOrigin(origin: string, host: string | undefined): boolean {
    if (!host) {
        return false;
    }
    try {
        const url = new URL(origin);
        return (
            (url.protocol === 'http:' || url.protocol === 'https:') &&
            url.host.toLowerCase() === host.toLowerCase()
        );
    } catch {
        return false;
    }
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
            return {
                allowed: false,
                reason: 'Host header is not allowed (add it to DEXTO_ALLOWED_HOSTS to permit it)',
            };
        }

        if (!STATE_CHANGING_METHODS.has(method.toUpperCase())) {
            return { allowed: true };
        }

        const origin = header('origin');
        if (
            origin !== undefined &&
            !isAllowedRequestOrigin(origin) &&
            !isSameOrigin(origin, header('host'))
        ) {
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
            header: (name) => {
                const value = ctx.req.header(name);
                if (value !== undefined || name.toLowerCase() !== 'host') {
                    return value;
                }
                // In-process app.fetch() requests carry no Host header; their URL was chosen by
                // the embedding code, not by a remote client, so use its host instead.
                try {
                    return new URL(ctx.req.url).host;
                } catch {
                    return undefined;
                }
            },
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
