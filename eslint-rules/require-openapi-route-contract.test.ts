import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import rule from './require-openapi-route-contract.js';

const ruleTester = new RuleTester({
    languageOptions: {
        parser: tsParser,
        ecmaVersion: 2022,
        sourceType: 'module',
    },
});

ruleTester.run('require-openapi-route-contract', rule, {
    valid: [
        {
            filename: '/repo/packages/server/src/hono/routes/sessions.ts',
            code: `
                import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
                import { z } from 'zod';

                const app = new OpenAPIHono();
                const route = createRoute({
                    method: 'get',
                    path: '/sessions',
                    responses: {
                        200: {
                            description: 'OK',
                            content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
                        },
                    },
                });

                app.openapi(route, async (ctx) => {
                    return ctx.json({ ok: true }, 200);
                });
            `,
        },
        {
            filename: '/repo/packages/server/src/hono/routes/a2a.ts',
            code: `
                import { Hono } from 'hono';

                export function createA2aRouter() {
                    // eslint-disable-next-line rule-to-test/require-openapi-route-contract -- A2A well-known metadata endpoint is protocol metadata, not a normal OpenAPI JSON route.
                    const app = new Hono();
                    app.get('/.well-known/agent-card.json', (ctx) => ctx.json({ ok: true }, 200));
                    return app;
                }
            `,
        },
        {
            filename: '/repo/packages/server/src/hono/routes/a2a-tasks.ts',
            code: `
                import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
                import { z } from 'zod';

                const app = new OpenAPIHono();
                const route = createRoute({
                    method: 'get',
                    path: '/tasks',
                    responses: {
                        200: {
                            description: 'OK',
                            content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
                        },
                    },
                });

                // eslint-disable-next-line rule-to-test/require-openapi-route-contract -- SSE transport endpoint is an explicit protocol exception and is not documented as a normal JSON route.
                app.post('/v1/message:stream', async () => new Response(null));
                app.openapi(route, async (ctx) => ctx.json({ ok: true }, 200));
            `,
        },
        {
            filename: '/repo/packages/server/src/not-routes/example.ts',
            code: `
                import { Hono } from 'hono';

                const app = new Hono();
                app.get('/x', (ctx) => ctx.json({ ok: true }, 200));
            `,
        },
    ],
    invalid: [
        {
            filename: '/repo/packages/server/src/hono/routes/plain-json.ts',
            code: `
                import { Hono } from 'hono';

                export function createPlainJsonRouter() {
                    const app = new Hono();
                    app.get('/x', (ctx) => ctx.json({ ok: true }, 200));
                    return app;
                }
            `,
            errors: [
                {
                    messageId: 'plainHono',
                },
            ],
        },
        {
            filename: '/repo/packages/server/src/hono/routes/plain-json-aliased.ts',
            code: `
                import { Hono as BaseRouter } from 'hono';

                export function createPlainJsonRouter() {
                    const router = new BaseRouter();
                    return router;
                }
            `,
            errors: [
                {
                    messageId: 'plainHono',
                },
            ],
        },
        {
            filename: '/repo/packages/server/src/hono/routes/direct-openapi-method.ts',
            code: `
                import { OpenAPIHono } from '@hono/zod-openapi';

                const app = new OpenAPIHono();
                app.get('/x', (ctx) => ctx.json({ ok: true }, 200));
            `,
            errors: [
                {
                    messageId: 'directRouteMethod',
                },
            ],
        },
        {
            filename: '/repo/packages/server/src/hono/routes/direct-openapi-method-aliased.ts',
            code: `
                import { OpenAPIHono as ContractRouter } from '@hono/zod-openapi';

                const router = new ContractRouter();
                router.post('/x', (ctx) => ctx.json({ ok: true }, 200));
            `,
            errors: [
                {
                    messageId: 'directRouteMethod',
                },
            ],
        },
    ],
});
