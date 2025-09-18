import type { Context } from 'hono';

export function sendJson<T>(ctx: Context, data: T, status: number = 200) {
    const prettyParam = ctx.req.query('pretty');
    const shouldPretty = prettyParam === 'true' || prettyParam === '1';
    const payload = shouldPretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
    return new Response(payload, {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}
