import type { MiddlewareHandler } from 'hono';

/**
 * Marks responses from downstream handlers for sensitive-data redaction.
 * The actual redaction is applied inside shared response helpers (e.g. sendJson).
 */
export const redactionMiddleware: MiddlewareHandler = async (ctx, next) => {
    ctx.set('redactResponse', true);
    await next();
};
