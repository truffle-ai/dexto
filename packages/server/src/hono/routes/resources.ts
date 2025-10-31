import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { DextoAgent } from '@dexto/core';

const ResourceIdParamSchema = z.object({
    resourceId: z
        .string()
        .min(1, 'Resource ID is required')
        .transform((encoded) => decodeURIComponent(encoded))
        .describe('The URI-encoded resource identifier'),
});

export function createResourcesRouter(getAgent: () => DextoAgent) {
    const app = new OpenAPIHono();

    const listRoute = createRoute({
        method: 'get',
        path: '/resources',
        summary: 'List All Resources',
        description:
            'Retrieves a list of all available resources from all sources (MCP servers and internal providers)',
        tags: ['resources'],
        responses: {
            200: {
                description: 'List all resources',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    app.openapi(listRoute, async (ctx) => {
        const agent = getAgent();
        const resources = await agent.listResources();
        return ctx.json({ ok: true, resources: Object.values(resources) });
    });

    const getContentRoute = createRoute({
        method: 'get',
        path: '/resources/{resourceId}/content',
        summary: 'Read Resource Content',
        description:
            'Reads the content of a specific resource by its URI. The resource ID in the URL must be URI-encoded',
        tags: ['resources'],
        request: {
            params: ResourceIdParamSchema,
        },
        responses: {
            200: {
                description: 'Resource content',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    app.openapi(getContentRoute, async (ctx) => {
        const agent = getAgent();
        const { resourceId } = ctx.req.valid('param');
        const content = await agent.readResource(resourceId);
        return ctx.json({ ok: true, content });
    });

    const headRoute = createRoute({
        method: 'head',
        path: '/resources/{resourceId}',
        summary: 'Check Resource Exists',
        description: 'Checks if a resource exists by its URI without retrieving its content',
        tags: ['resources'],
        request: {
            params: ResourceIdParamSchema,
        },
        responses: {
            200: { description: 'Resource exists' },
            404: { description: 'Resource not found' },
        },
    });
    app.openapi(headRoute, async (ctx) => {
        const agent = getAgent();
        const { resourceId } = ctx.req.valid('param');
        const exists = await agent.hasResource(resourceId);
        return ctx.body(null, exists ? 200 : 404);
    });

    return app;
}
