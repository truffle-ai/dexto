import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { ResourceSchema } from '../schemas/responses.js';
import type { GetAgentFn } from '../index.js';

const ResourceIdParamSchema = z
    .object({
        resourceId: z
            .string()
            .min(1, 'Resource ID is required')
            .transform((encoded) => decodeURIComponent(encoded))
            .describe('The URI-encoded resource identifier'),
    })
    .describe('Path parameters for resource endpoints');

// Response schemas for resources endpoints

const ListResourcesResponseSchema = z
    .object({
        ok: z.literal(true).describe('Indicates successful response'),
        resources: z
            .array(ResourceSchema)
            .describe('Array of all available resources from all sources'),
    })
    .strict()
    .describe('List of all resources');

const ResourceContentItemSchema = z
    .object({
        uri: z.string().describe('Resource URI'),
        mimeType: z.string().optional().describe('MIME type of the content'),
        text: z.string().optional().describe('Text content (for text resources)'),
        blob: z
            .string()
            .optional()
            .describe('Base64-encoded binary content (for binary resources)'),
    })
    .strict()
    .describe('Resource content item');

const ReadResourceResponseSchema = z
    .object({
        ok: z.literal(true).describe('Indicates successful response'),
        content: z
            .object({
                contents: z
                    .array(ResourceContentItemSchema)
                    .describe('Array of content items (typically one item)'),
                _meta: z
                    .record(z.any())
                    .optional()
                    .describe('Optional metadata about the resource'),
            })
            .strict()
            .describe('Resource content from MCP ReadResourceResult'),
    })
    .strict()
    .describe('Resource content response');

export function createResourcesRouter(getAgent: GetAgentFn) {
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
                content: { 'application/json': { schema: ListResourcesResponseSchema } },
            },
        },
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
                content: { 'application/json': { schema: ReadResourceResponseSchema } },
            },
        },
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

    return app
        .openapi(listRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const resources = await agent.listResources();
            return ctx.json({ ok: true, resources: Object.values(resources) });
        })
        .openapi(getContentRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { resourceId } = ctx.req.valid('param');
            const content = await agent.readResource(resourceId);
            return ctx.json({ ok: true, content });
        })
        .openapi(headRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { resourceId } = ctx.req.valid('param');
            const exists = await agent.hasResource(resourceId);
            return ctx.body(null, exists ? 200 : 404);
        });
}
