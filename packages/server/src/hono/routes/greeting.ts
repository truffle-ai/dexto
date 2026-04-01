import { OpenAPIHono, createRoute, type RouteConfigToTypedResponse, z } from '@hono/zod-openapi';
import type { ToSchema } from 'hono/types';
import { BadRequestErrorResponse, InternalErrorResponse } from '../schemas/responses.js';
import type { GetAgentFn } from '../types.js';

const GreetingQuerySchema = z
    .object({
        sessionId: z
            .string()
            .optional()
            .describe('Session identifier to retrieve session-specific greeting'),
    })
    .describe('Query parameters for greeting endpoint');

const GreetingResponseSchema = z
    .object({
        greeting: z.string().optional().describe('Greeting message from agent configuration'),
    })
    .strict()
    .describe('Greeting response payload');

const greetingRoute = createRoute({
    method: 'get',
    path: '/greeting',
    summary: 'Get Greeting Message',
    description: 'Retrieves the greeting message from the agent configuration',
    tags: ['config'],
    request: { query: GreetingQuerySchema.pick({ sessionId: true }) },
    responses: {
        200: {
            description: 'Greeting',
            content: {
                'application/json': {
                    schema: GreetingResponseSchema,
                },
            },
        },
        400: BadRequestErrorResponse,
        500: InternalErrorResponse,
    },
});

export function createGreetingRouter(getAgent: GetAgentFn) {
    const app = new OpenAPIHono();

    return app.openapi(greetingRoute, async (ctx) => {
        const agent = await getAgent(ctx);
        const { sessionId } = ctx.req.valid('query');
        const cfg = agent.getEffectiveConfig(sessionId);
        return ctx.json({ greeting: cfg.greeting }, 200);
    });
}

export type GreetingRouterSchema = ToSchema<
    'get',
    '/greeting',
    { query: z.input<typeof GreetingQuerySchema> },
    RouteConfigToTypedResponse<typeof greetingRoute>
>;
