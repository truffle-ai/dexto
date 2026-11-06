import { cors } from 'hono/cors';
import type { MiddlewareHandler } from 'hono';
import { DEXTO_REQUEST_HEADER, isAllowedRequestOrigin } from './request-guard.js';

/**
 * CORS middleware that allows:
 * 1. All localhost/127.0.0.1 origins on any port (for local development)
 * 2. Custom origins specified in DEXTO_ALLOWED_ORIGINS environment variable
 * 3. Server-to-server requests with no origin header
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
