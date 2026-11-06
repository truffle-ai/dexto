import type { MiddlewareHandler } from 'hono';
import { logger } from '@dexto/core';

/**
 * Browser-facing request checks for the Dexto HTTP API.
 *
 * CORS only controls whether a browser may *read* a cross-origin response; it does not stop
 * the request from reaching the server. These checks reject requests a browser page on
 * another origin could send. Trust is per origin (scheme + host + port), never per host:
 * a page on another port of localhost is a different origin and is not trusted.
 *
 * 1. Every method except OPTIONS: an `Origin` header, when present, must be the server's own
 *    origin (the authority in the request's `Host`) or listed in DEXTO_ALLOWED_ORIGINS.
 *    `Origin: null` is rejected.
 *    (Navigations and same-origin reads send no Origin, so links to the Web UI still work.)
 * 2. State-changing methods (POST, PUT, PATCH, DELETE):
 *    - `Sec-Fetch-Site: same-site` or `cross-site` is rejected unless the `Origin` is listed
 *      in DEXTO_ALLOWED_ORIGINS;
 *    - the request must carry a header a browser cannot send cross-origin without a CORS
 *      preflight: `Authorization`, `X-Dexto-Request`, or a non-simple `Content-Type`
 *      (for example `application/json`).
 * 3. When the server runs without authentication (no API key, not production, no
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

function normalizeOrigin(value: string): string | undefined {
    try {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return undefined;
        }
        return url.origin;
    } catch {
        return undefined;
    }
}

/**
 * True when `origin` is listed in DEXTO_ALLOWED_ORIGINS (compared as serialized origins, so a
 * trailing slash or default port in the setting does not matter). These are the only
 * cross-origin pages the API trusts; CORS reflects only these.
 */
export function isAllowedRequestOrigin(origin: string): boolean {
    const normalized = normalizeOrigin(origin);
    if (normalized === undefined) {
        return false;
    }
    return listFromEnv('DEXTO_ALLOWED_ORIGINS').some(
        (entry) => normalizeOrigin(entry) === normalized
    );
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
 * True when `origin` is the server's own origin: a page served by this server (the bundled
 * Web UI, or the same server behind a proxy) sends an Origin whose host and port equal the
 * request's `Host`, which is the authority the browser connected to. A page on another port
 * of the same host has a different authority and does not match. Without auth the Host itself
 * has already been checked against loopback, so this cannot admit a rebinding page.
 * The scheme is not compared: one host:port is one listener, and a TLS-terminating proxy in
 * front of the server makes the browser's scheme differ from the server's.
 */
function isSameOrigin(origin: string, host: string | undefined): boolean {
    if (!host) {
        return false;
    }
    try {
        const url = new URL(origin);
        return (
            (url.protocol === 'http:' || url.protocol === 'https:') &&
            url.host.toLowerCase() === new URL(`${url.protocol}//${host}`).host.toLowerCase()
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

        const origin = header('origin');
        const configuredOrigin = origin !== undefined && isAllowedRequestOrigin(origin);
        if (origin !== undefined && !configuredOrigin && !isSameOrigin(origin, header('host'))) {
            return {
                allowed: false,
                reason: 'Origin is not allowed (add it to DEXTO_ALLOWED_ORIGINS to permit it)',
            };
        }
        if (!STATE_CHANGING_METHODS.has(method.toUpperCase())) {
            // Reads from another origin carry an Origin (CORS mode) and were checked above.
            // Navigations carry no Origin and may come from any site (a link to the Web UI).
            return { allowed: true };
        }

        // Fetch metadata: a write from another origin is accepted only from an origin the
        // operator listed explicitly, the same rule CORS applies to its preflight.
        const fetchSite = header('sec-fetch-site')?.toLowerCase();
        if ((fetchSite === 'cross-site' || fetchSite === 'same-site') && !configuredOrigin) {
            return { allowed: false, reason: 'Cross-origin request from an origin not allowed' };
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
