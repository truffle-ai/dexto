import { z } from 'zod';
import { TOOL_ACTIVITY, ToolError, createLocalToolCallHeader, defineTool } from '@dexto/core/tools';
import type { Tool, ToolExecutionContext } from '@dexto/core/tools';

const ListResourcesInputSchema = z
    .object({
        source: z
            .enum(['all', 'tool', 'user'])
            .optional()
            .default('all')
            .describe(
                'Filter by source: "tool" for tool-generated resources, "user" for user-uploaded, "all" for both'
            ),
        kind: z
            .enum(['all', 'image', 'audio', 'video', 'binary'])
            .optional()
            .default('all')
            .describe('Filter by type: "image", "audio", "video", "binary", or "all"'),
        limit: z
            .number()
            .optional()
            .default(50)
            .describe('Maximum number of resources to return (default: 50)'),
    })
    .strict();

interface ResourceInfo {
    reference: string;
    kind: string;
    mimeType: string;
    filename?: string;
    source: 'tool' | 'user' | 'system';
    size: number;
    createdAt: string;
}

/**
 * Create the `list_resources` tool.
 *
 * Lists stored resources (backed by the configured artifact store) and returns references
 * that can be passed to `get_resource`.
 * Requires `ToolExecutionContext.services.resources`.
 */
export function createListResourcesTool(): Tool<typeof ListResourcesInputSchema> {
    return defineTool({
        id: 'list_resources',
        description:
            'List available resources (images, files, etc.). Returns resource references ' +
            'that can be used with get_resource to obtain shareable URLs or metadata. ' +
            'Filter by source (tool/user) or kind (image/audio/video/binary).',
        inputSchema: ListResourcesInputSchema,
        presentation: {
            activity: TOOL_ACTIVITY.listResources,
            describeHeader: (input) => {
                const parts: string[] = [];
                if (input.source && input.source !== 'all') parts.push(`source=${input.source}`);
                if (input.kind && input.kind !== 'all') parts.push(`kind=${input.kind}`);
                if (typeof input.limit === 'number') parts.push(`limit=${input.limit}`);

                return createLocalToolCallHeader({
                    title: 'List Resources',
                    ...(parts.length > 0 ? { argsText: parts.join(', ') } : {}),
                });
            },
        },
        async execute(input, context: ToolExecutionContext) {
            const { source, kind, limit } = input;

            const resourceManager = context.services?.resources;
            if (!resourceManager) {
                throw ToolError.configInvalid(
                    'list_resources requires ToolExecutionContext.services.resources'
                );
            }

            try {
                const artifactStore = resourceManager.getArtifactStore();
                const artifacts = await artifactStore.listArtifacts();

                const resources: ResourceInfo[] = [];

                for (const artifact of artifacts) {
                    if (artifact.metadata.source === 'system') {
                        continue;
                    }

                    if (source !== 'all' && artifact.metadata.source !== source) {
                        continue;
                    }

                    const mimeType = artifact.metadata.mimeType;
                    let resourceKind: 'image' | 'audio' | 'video' | 'binary' = 'binary';
                    if (mimeType.startsWith('image/')) resourceKind = 'image';
                    else if (mimeType.startsWith('audio/')) resourceKind = 'audio';
                    else if (mimeType.startsWith('video/')) resourceKind = 'video';

                    if (kind !== 'all' && resourceKind !== kind) {
                        continue;
                    }

                    resources.push({
                        reference: artifact.uri,
                        kind: resourceKind,
                        mimeType: artifact.metadata.mimeType,
                        ...(artifact.metadata.originalName && {
                            filename: artifact.metadata.originalName,
                        }),
                        source: artifact.metadata.source || 'tool',
                        size: artifact.metadata.size,
                        createdAt: artifact.metadata.createdAt.toISOString(),
                    });
                }

                resources.sort(
                    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                );
                const limitedResources = resources.slice(0, limit);

                return {
                    success: true,
                    count: limitedResources.length,
                    resources: limitedResources,
                    _hint:
                        limitedResources.length > 0
                            ? 'Use get_resource with a reference to get a shareable URL or metadata'
                            : 'No resources found matching the criteria',
                };
            } catch (error) {
                return {
                    success: false,
                    error: `Failed to list resources: ${error instanceof Error ? error.message : String(error)}`,
                    resources: [],
                };
            }
        },
    });
}
