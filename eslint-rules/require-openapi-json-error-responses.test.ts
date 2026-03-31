import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import rule from './require-openapi-json-error-responses.js';

const ruleTester = new RuleTester({
    languageOptions: {
        parser: tsParser,
        ecmaVersion: 2022,
        sourceType: 'module',
    },
});

ruleTester.run('require-openapi-json-error-responses', rule, {
    valid: [
        {
            filename: '/repo/packages/server/src/hono/routes/messages.ts',
            code: `
                import { createRoute, z } from '@hono/zod-openapi';

                const route = createRoute({
                    method: 'post',
                    path: '/message',
                    responses: {
                        202: {
                            description: 'Accepted',
                            content: {
                                'application/json': {
                                    schema: z.object({ accepted: z.literal(true) }),
                                },
                            },
                        },
                        400: {
                            description: 'Bad request',
                            content: {
                                'application/json': {
                                    schema: z.object({ message: z.string() }),
                                },
                            },
                        },
                    },
                });
            `,
        },
        {
            filename: 'C:\\repo\\packages\\server\\src\\hono\\routes\\messages.ts',
            code: `
                import { createRoute, z } from '@hono/zod-openapi';

                const route = createRoute({
                    method: 'post',
                    path: '/message',
                    responses: {
                        202: {
                            description: 'Accepted',
                            content: {
                                'application/json': {
                                    schema: z.object({ accepted: z.literal(true) }),
                                },
                            },
                        },
                        400: {
                            description: 'Bad request',
                            content: {
                                'application/json': {
                                    schema: z.object({ message: z.string() }),
                                },
                            },
                        },
                    },
                });
            `,
        },
        {
            filename: '/repo/packages/server/src/hono/routes/health.ts',
            code: `
                import { createRoute, z } from '@hono/zod-openapi';

                const route = createRoute({
                    method: 'get',
                    path: '/health',
                    responses: {
                        200: {
                            description: 'OK',
                            content: {
                                'text/plain': {
                                    schema: z.string(),
                                },
                            },
                        },
                    },
                });
            `,
        },
        {
            filename: '/repo/packages/server/src/hono/routes/a2a-tasks.ts',
            code: `
                import { createRoute, z } from '@hono/zod-openapi';

                // eslint-disable-next-line rule-to-test/require-openapi-json-error-responses -- SSE transport route intentionally documents only stream and queue-success behavior here.
                const route = createRoute({
                    method: 'post',
                    path: '/message-stream',
                    responses: {
                        200: {
                            description: 'Stream',
                            content: {
                                'text/event-stream': {
                                    schema: z.string(),
                                },
                            },
                        },
                        202: {
                            description: 'Busy',
                            content: {
                                'application/json': {
                                    schema: z.object({ busy: z.literal(true) }),
                                },
                            },
                        },
                    },
                });
            `,
        },
        {
            filename: '/repo/packages/server/src/hono/routes/aliased.ts',
            code: `
                import { createRoute as defineRoute, z } from '@hono/zod-openapi';

                const route = defineRoute({
                    method: 'get',
                    path: '/thing',
                    responses: {
                        200: {
                            description: 'OK',
                            content: {
                                'application/json': {
                                    schema: z.object({ ok: z.boolean() }),
                                },
                            },
                        },
                        404: {
                            description: 'Missing',
                            content: {
                                'application/json': {
                                    schema: z.object({ message: z.string() }),
                                },
                            },
                        },
                    },
                });
            `,
        },
        {
            filename: '/repo/packages/server/src/hono/routes/with-indexed-errors.ts',
            code: `
                import { createRoute, z } from '@hono/zod-openapi';

                const commonErrors = {
                    400: {
                        description: 'Bad request',
                        content: {
                            'application/json': {
                                schema: z.object({ message: z.string() }),
                            },
                        },
                    },
                    500: {
                        description: 'Internal error',
                        content: {
                            'application/json': {
                                schema: z.object({ message: z.string() }),
                            },
                        },
                    },
                } as const;

                const route = createRoute({
                    method: 'get',
                    path: '/thing',
                    responses: {
                        200: {
                            description: 'OK',
                            content: {
                                'application/json': {
                                    schema: z.object({ ok: z.boolean() }),
                                },
                            },
                        },
                        400: commonErrors[400],
                        500: commonErrors[500],
                    },
                });
            `,
        },
        {
            filename: '/repo/packages/server/src/hono/routes/hoisted.ts',
            code: `
                import { createRoute, z } from '@hono/zod-openapi';

                const responses = {
                    200: {
                        description: 'OK',
                        content: {
                            'application/json': {
                                schema: z.object({ ok: z.boolean() }),
                            },
                        },
                    },
                    400: {
                        description: 'Bad request',
                        content: {
                            'application/json': {
                                schema: z.object({ message: z.string() }),
                            },
                        },
                    },
                } as const;

                const routeConfig = {
                    method: 'get',
                    path: '/thing',
                    responses,
                } satisfies Record<string, unknown>;

                const route = createRoute(routeConfig);
            `,
        },
        {
            filename: '/repo/packages/server/src/hono/routes/hoisted-responses.ts',
            code: `
                import { createRoute, z } from '@hono/zod-openapi';

                const successResponse = {
                    description: 'OK',
                    content: {
                        'application/json': {
                            schema: z.object({ ok: z.boolean() }),
                        },
                    },
                } as const;

                const errorResponse = {
                    description: 'Bad request',
                    content: {
                        'application/json': {
                            schema: z.object({ message: z.string() }),
                        },
                    },
                } as const;

                const route = createRoute({
                    method: 'get',
                    path: '/thing',
                    responses: {
                        200: successResponse,
                        400: errorResponse,
                    },
                });
            `,
        },
    ],
    invalid: [
        {
            filename: '/repo/packages/server/src/hono/routes/sessions.ts',
            code: `
                import { createRoute, z } from '@hono/zod-openapi';

                const route = createRoute({
                    method: 'get',
                    path: '/sessions',
                    responses: {
                        200: {
                            description: 'Sessions',
                            content: {
                                'application/json': {
                                    schema: z.object({ sessions: z.array(z.string()) }),
                                },
                            },
                        },
                    },
                });
            `,
            errors: [
                {
                    messageId: 'successOnlyJsonRoute',
                },
            ],
        },
        {
            filename: '/repo/packages/server/src/hono/routes/hoisted-invalid.ts',
            code: `
                import { createRoute, z } from '@hono/zod-openapi';

                const responses = {
                    200: {
                        description: 'Sessions',
                        content: {
                            'application/json': {
                                schema: z.object({ sessions: z.array(z.string()) }),
                            },
                        },
                    },
                } as const;

                const routeConfig = {
                    method: 'get',
                    path: '/sessions',
                    responses,
                } satisfies Record<string, unknown>;

                const route = createRoute(routeConfig);
            `,
            errors: [
                {
                    messageId: 'successOnlyJsonRoute',
                },
            ],
        },
        {
            filename: '/repo/packages/server/src/hono/routes/sessions.ts',
            code: `
                import { createRoute, z } from '@hono/zod-openapi';

                const route = createRoute({
                    method: 'post',
                    path: '/sessions',
                    responses: {
                        201: {
                            description: 'Created',
                            content: {
                                'application/json': {
                                    schema: z.object({ sessionId: z.string() }),
                                },
                            },
                        },
                    },
                });
            `,
            errors: [
                {
                    messageId: 'successOnlyJsonRoute',
                },
            ],
        },
        {
            filename: '/repo/packages/server/src/hono/routes/mixed.ts',
            code: `
                import { createRoute, z } from '@hono/zod-openapi';

                const route = createRoute({
                    method: 'delete',
                    path: '/thing',
                    responses: {
                        204: {
                            description: 'Deleted',
                        },
                        200: {
                            description: 'Also ok',
                            content: {
                                'application/json': {
                                    schema: z.object({ ok: z.boolean() }),
                                },
                            },
                        },
                    },
                });
            `,
            errors: [
                {
                    messageId: 'successOnlyJsonRoute',
                },
            ],
        },
        {
            filename: '/repo/packages/server/src/hono/routes/with-spread.ts',
            code: `
                import { createRoute, z } from '@hono/zod-openapi';

                const commonErrors = {
                    400: {
                        description: 'Bad request',
                        content: {
                            'application/json': {
                                schema: z.object({ message: z.string() }),
                            },
                        },
                    },
                    500: {
                        description: 'Internal error',
                        content: {
                            'application/json': {
                                schema: z.object({ message: z.string() }),
                            },
                        },
                    },
                } as const;

                const route = createRoute({
                    method: 'get',
                    path: '/thing',
                    responses: {
                        200: {
                            description: 'OK',
                            content: {
                                'application/json': {
                                    schema: z.object({ ok: z.boolean() }),
                                },
                            },
                        },
                        ...commonErrors,
                    },
                });
            `,
            errors: [
                {
                    messageId: 'spreadResponseEntries',
                },
            ],
        },
        {
            filename: '/repo/packages/server/src/hono/routes/hoisted-success-only.ts',
            code: `
                import { createRoute, z } from '@hono/zod-openapi';

                const responses = {
                    200: {
                        description: 'OK',
                        content: {
                            'application/json': {
                                schema: z.object({ ok: z.boolean() }),
                            },
                        },
                    },
                } as const;

                const routeConfig = {
                    method: 'get',
                    path: '/thing',
                    responses,
                } satisfies Record<string, unknown>;

                const route = createRoute(routeConfig);
            `,
            errors: [
                {
                    messageId: 'successOnlyJsonRoute',
                },
            ],
        },
    ],
});
