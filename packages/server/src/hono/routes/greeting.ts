import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { DextoAgent } from '@dexto/core';

const querySchema = z.object({
    sessionId: z
        .string()
        .optional()
        .describe('Session identifier to retrieve session-specific greeting'),
});

export function createGreetingRouter(getAgent: () => DextoAgent) {
    const app = new OpenAPIHono();

    const greetingRoute = createRoute({
        method: 'get',
        path: '/greeting',
        summary: 'Get Greeting Message',
        description: 'Retrieves the greeting message from the agent configuration',
        tags: ['config'],
        request: { query: querySchema.pick({ sessionId: true }) },
        responses: {
            200: { description: 'Greeting', content: { 'application/json': { schema: z.any() } } },
        },
    });

    app.openapi(greetingRoute, (ctx) => {
        const agent = getAgent();
        const { sessionId } = ctx.req.valid('query');
        const cfg = agent.getEffectiveConfig(sessionId);
        return ctx.json({ greeting: cfg.greeting });
    });

    return app;
}
