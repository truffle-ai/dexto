import { cors } from 'hono/cors';
import type { MiddlewareHandler } from 'hono';
import { DEXTO_REQUEST_HEADER, isAllowedRequestOrigin } from './request-guard.js';

/**
 * CORS middleware. Only origins listed in DEXTO_ALLOWED_ORIGINS are reflected; the bundled
 * Web UI is served from the server's own origin and needs no CORS. Other pages, including
 * pages on other ports of localhost, get no CORS headers, so their preflights fail and they
 * cannot read responses. Requests without an Origin (non-browser clients) get no CORS headers.
 */
export function createCorsMiddleware(): MiddlewareHandler {
    return cors({
        origin: (origin) => {
            // If no origin header (server-to-server), omit CORS headers
            // Returning null allows the request without Access-Control-Allow-Origin header
            // This is compatible with credentials: true (unlike '*')
            if (!origin) {
                return null;
            }

            return isAllowedRequestOrigin(origin) ? origin : null;
        },
        allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
        allowHeaders: ['Content-Type', 'Authorization', DEXTO_REQUEST_HEADER],
        credentials: true,
    });
}
