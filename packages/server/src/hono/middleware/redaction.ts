import { prettyJSON } from 'hono/pretty-json';
import type { MiddlewareHandler } from 'hono';
import { redactSensitiveData } from '@dexto/core';

export const prettyJsonMiddleware = prettyJSON();

export const redactionMiddleware: MiddlewareHandler = async (ctx, next) => {
    // TODO: tighten types once Hono exposes typed overrides for ctx.json/ctx.body
    const originalJson = ctx.json.bind(ctx) as any;
    ctx.json = ((data: any, status?: any, headers?: any) => {
        const redacted = redactSensitiveData(data);
        return originalJson(redacted, status, headers);
    }) as typeof ctx.json;

    const originalBody = ctx.body.bind(ctx) as any;
    ctx.body = ((data: any, status?: any, headers?: any) => {
        const payload = typeof data === 'string' ? redactSensitiveData(data) : data;
        return originalBody(payload, status, headers);
    }) as typeof ctx.body;

    await next();
};
