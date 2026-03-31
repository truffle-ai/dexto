import type { Context } from 'hono';
import type { Hono } from 'hono';
import type { RouteConfig, RouteConfigToTypedResponse } from '@hono/zod-openapi';
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { DextoAgent } from '@dexto/core';
import type { Input, ToSchema } from 'hono/types';
import type { WebhookEventSubscriber } from '../events/webhook-subscriber.js';

export type DextoApp = OpenAPIHono & {
    webhookSubscriber?: WebhookEventSubscriber;
};

export type GetAgentFn = (ctx: Context) => DextoAgent | Promise<DextoAgent>;

export type GetAgentConfigPathFn = (
    ctx: Context
) => string | undefined | Promise<string | undefined>;

export type OpenAPIRouteSchema<
    R extends RouteConfig & { getRoutingPath(): string },
    I extends Input['in'],
> = ToSchema<R['method'], ReturnType<R['getRoutingPath']>, I, RouteConfigToTypedResponse<R>>;

export type HonoRouterSchema<T> = T extends Hono<any, infer S, any> ? S : never;
