import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { DextoImageModule } from '@dexto/agent-config';
import { loadImage } from '@dexto/agent-config';
import { loadAgentConfig } from '@dexto/agent-management';
import imageLocal from '@dexto/image-local';

export type GetAgentConfigPathFn = (
    ctx: Context
) => string | undefined | Promise<string | undefined>;

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

const ToolSchema = z
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
        internalTools: z.array(ToolSchema).describe('Internal tools available for configuration'),
    })
    .describe('Discovery response with providers grouped by category');

type DiscoveryMetadataValue = string | number | boolean | null;
type DiscoveryMetadata = Record<string, DiscoveryMetadataValue>;

function toMetadata(metadata: unknown): DiscoveryMetadata | undefined {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        return undefined;
    }

    const record = metadata as Record<string, unknown>;
    const result: DiscoveryMetadata = {};
    for (const [key, value] of Object.entries(record)) {
        if (value === undefined) {
            continue;
        }

        if (
            value === null ||
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
        ) {
            result[key] = value;
        }
    }

    return Object.keys(result).length > 0 ? result : undefined;
}

async function resolveImageModule(options: {
    ctx: Context;
    getAgentConfigPath: GetAgentConfigPathFn;
}): Promise<DextoImageModule> {
    const { ctx, getAgentConfigPath } = options;

    const configPath = await getAgentConfigPath(ctx);
    if (!configPath) {
        return imageLocal;
    }

    const rawConfig = await loadAgentConfig(configPath);
    const imageName =
        (typeof rawConfig.image === 'string' && rawConfig.image.length > 0
            ? rawConfig.image
            : undefined) ??
        process.env.DEXTO_IMAGE ??
        '@dexto/image-local';

    if (imageName === '@dexto/image-local') {
        return imageLocal;
    }

    try {
        return await loadImage(imageName);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
            `Failed to load image module '${imageName}'. Ensure it is installed and that the host called setImageImporter(). Original error: ${message}`
        );
    }
}

async function listDiscoveryProviders(options: {
    ctx: Context;
    getAgentConfigPath: GetAgentConfigPathFn;
}) {
    const image = await resolveImageModule(options);

    const blob = Object.entries(image.storage.blob).map(([type, provider]) => ({
        type,
        category: 'blob' as const,
        metadata: toMetadata(provider.metadata),
    }));

    const database = Object.entries(image.storage.database).map(([type, provider]) => ({
        type,
        category: 'database' as const,
        metadata: toMetadata(provider.metadata),
    }));

    const compaction = Object.entries(image.compaction).map(([type, factory]) => ({
        type,
        category: 'compaction' as const,
        metadata: toMetadata(factory.metadata),
    }));

    const toolFactories = Object.entries(image.tools);
    const builtinFactory = toolFactories.find(([type]) => type === 'builtin-tools')?.[1];

    const internalTools = builtinFactory
        ? builtinFactory
              .create(builtinFactory.configSchema.parse({ type: 'builtin-tools' }))
              .map((tool) => ({
                  name: tool.id,
                  description: tool.description,
              }))
        : [];

    const customTools = toolFactories
        .filter(([type]) => type !== 'builtin-tools')
        .map(([type, factory]) => ({
            type,
            category: 'customTools' as const,
            metadata: toMetadata(factory.metadata),
        }));

    return { blob, database, compaction, customTools, internalTools };
}

export function createDiscoveryRouter(getAgentConfigPath: GetAgentConfigPathFn) {
    const app = new OpenAPIHono();

    const discoveryRoute = createRoute({
        method: 'get',
        path: '/discovery',
        summary: 'Discover Available Providers and Tools',
        description:
            'Returns all available providers (blob storage, database, compaction, tools) for the currently active image.',
        tags: ['discovery'],
        responses: {
            200: {
                description: 'Available providers grouped by category',
                content: { 'application/json': { schema: DiscoveryResponseSchema } },
            },
        },
    });

    return app.openapi(discoveryRoute, async (ctx) => {
        return ctx.json(await listDiscoveryProviders({ ctx, getAgentConfigPath }));
    });
}
