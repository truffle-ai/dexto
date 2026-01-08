import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { GetAgentFn } from '../index.js';

const querySchema = z
    .object({
        sessionId: z
            .string()
            .optional()
            .describe('Session identifier to retrieve session-specific greeting'),
    })
    .describe('Query parameters for greeting endpoint');

export function createGreetingRouter(getAgent: GetAgentFn) {
    const app = new OpenAPIHono();

    const greetingRoute = createRoute({
        method: 'get',
        path: '/greeting',
        summary: 'Get Greeting Message',
        description: 'Retrieves the greeting message from the agent configuration',
        tags: ['config'],
        request: { query: querySchema.pick({ sessionId: true }) },
        responses: {
            200: {
                description: 'Greeting',
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                greeting: z
                                    .string()
                                    .optional()
                                    .describe('Greeting message from agent configuration'),
                            })
                            .strict(),
                    },
                },
            },
        },
    });

    return app.openapi(greetingRoute, async (ctx) => {
        const agent = await getAgent(ctx);
        const { sessionId } = ctx.req.valid('query');
        const cfg = agent.getEffectiveConfig(sessionId);
        return ctx.json({ greeting: cfg.greeting });
    });
}
