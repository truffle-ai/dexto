import { cors } from 'hono/cors';
import type { MiddlewareHandler } from 'hono';

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

            try {
                const originUrl = new URL(origin);
                const hostname = originUrl.hostname;

                // Always allow localhost/127.0.0.1 on any port for local development
                if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
                    return origin;
                }

                // Check custom allowed origins from environment variable
                const customOrigins = process.env.DEXTO_ALLOWED_ORIGINS;
                if (customOrigins) {
                    const allowedList = customOrigins.split(',').map((o) => o.trim());
                    if (allowedList.includes(origin)) {
                        return origin;
                    }
                }

                // Origin not allowed
                return null;
            } catch {
                // Invalid URL format, reject
                return null;
            }
        },
        allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
        allowHeaders: ['Content-Type', 'Authorization'],
        credentials: true,
    });
}
