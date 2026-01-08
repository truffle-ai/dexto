import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { GetAgentFn } from '../index.js';

/**
 * NOTE: If we introduce a transport-agnostic handler layer later, the logic in this module can move
 * into that layer. For now we keep the implementation inline for simplicity.
 */
export function createHealthRouter(_getAgent: GetAgentFn) {
    const app = new OpenAPIHono();

    const route = createRoute({
        method: 'get',
        path: '/',
        summary: 'Health Check',
        description: 'Returns server health status',
        tags: ['system'],
        responses: {
            200: {
                description: 'Server health',
                content: { 'text/plain': { schema: z.string().openapi({ example: 'OK' }) } },
            },
        },
    });
    return app.openapi(route, (c) => c.text('OK'));
}
