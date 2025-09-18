import type { Context } from 'hono';
import type { ZodTypeAny } from 'zod';

type Infer<T extends ZodTypeAny> = T['_output'];

export async function parseJson<T extends ZodTypeAny>(ctx: Context, schema: T): Promise<Infer<T>> {
    const body = await ctx.req.json();
    return schema.parse(body) as Infer<T>;
}

export function parseQuery<T extends ZodTypeAny>(ctx: Context, schema: T): Infer<T> {
    const queryObject = ctx.req.query();
    return schema.parse(queryObject) as Infer<T>;
}

export function parseParam<T extends ZodTypeAny>(ctx: Context, schema: T): Infer<T> {
    const params = ctx.req.param();
    return schema.parse(params) as Infer<T>;
}
