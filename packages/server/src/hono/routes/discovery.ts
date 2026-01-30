import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { listAllProviders } from '@dexto/core';

const DiscoveredProviderSchema = z
    .object({
        type: z.string().describe('Provider type identifier'),
        category: z
            .enum(['blob', 'database', 'compaction', 'customTools'])
            .describe('Provider category'),
        metadata: z
            .object({
                displayName: z.string().optional().describe('Human-readable display name'),
                description: z.string().optional().describe('Provider description'),
            })
            .passthrough()
            .optional()
            .describe('Optional metadata about the provider'),
    })
    .describe('Information about a registered provider');

const InternalToolSchema = z
    .object({
        name: z
            .string()
            .describe('Internal tool name identifier (e.g., "search_history", "ask_user")'),
        description: z.string().describe('Human-readable description of what the tool does'),
    })
    .describe('Information about an internal tool');

const DiscoveryResponseSchema = z
    .object({
        blob: z.array(DiscoveredProviderSchema).describe('Blob storage providers'),
        database: z.array(DiscoveredProviderSchema).describe('Database providers'),
        compaction: z.array(DiscoveredProviderSchema).describe('Compaction strategy providers'),
        customTools: z.array(DiscoveredProviderSchema).describe('Custom tool providers'),
        internalTools: z
            .array(InternalToolSchema)
            .describe('Internal tools available for configuration'),
    })
    .describe('Discovery response with providers grouped by category');

export function createDiscoveryRouter() {
    const app = new OpenAPIHono();

    const discoveryRoute = createRoute({
        method: 'get',
        path: '/discovery',
        summary: 'Discover Available Providers and Tools',
        description:
            'Returns all registered providers (blob storage, database, compaction, custom tools) and available internal tools. Useful for building UIs that need to display configurable options.',
        tags: ['discovery'],
        responses: {
            200: {
                description: 'Available providers grouped by category',
                content: { 'application/json': { schema: DiscoveryResponseSchema } },
            },
        },
    });

    return app.openapi(discoveryRoute, async (ctx) => {
        const providers = listAllProviders();
        return ctx.json(providers);
    });
}
