import { z } from 'zod';
import type { Tool, ToolExecutionContext } from '@dexto/core';
import { ToolError } from '@dexto/core';

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

type ListResourcesInput = z.output<typeof ListResourcesInputSchema>;

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
 * Lists stored resources (backed by the configured BlobStore) and returns references
 * that can be passed to `get_resource`.
 * Requires `ToolExecutionContext.services.resources`.
 */
export function createListResourcesTool(): Tool {
    return {
        id: 'list_resources',
        description:
            'List available resources (images, files, etc.). Returns resource references ' +
            'that can be used with get_resource to obtain shareable URLs or metadata. ' +
            'Filter by source (tool/user) or kind (image/audio/video/binary).',
        inputSchema: ListResourcesInputSchema,
        execute: async (input: unknown, context: ToolExecutionContext) => {
            const { source, kind, limit } = input as ListResourcesInput;

            const resourceManager = context.services?.resources;
            if (!resourceManager) {
                throw ToolError.configInvalid(
                    'list_resources requires ToolExecutionContext.services.resources'
                );
            }

            try {
                const blobStore = resourceManager.getBlobStore();
                const allBlobs = await blobStore.listBlobs();

                const resources: ResourceInfo[] = [];

                for (const blob of allBlobs) {
                    if (blob.metadata.source === 'system') {
                        continue;
                    }

                    if (source !== 'all' && blob.metadata.source !== source) {
                        continue;
                    }

                    const mimeType = blob.metadata.mimeType;
                    let resourceKind: 'image' | 'audio' | 'video' | 'binary' = 'binary';
                    if (mimeType.startsWith('image/')) resourceKind = 'image';
                    else if (mimeType.startsWith('audio/')) resourceKind = 'audio';
                    else if (mimeType.startsWith('video/')) resourceKind = 'video';

                    if (kind !== 'all' && resourceKind !== kind) {
                        continue;
                    }

                    resources.push({
                        reference: blob.uri,
                        kind: resourceKind,
                        mimeType: blob.metadata.mimeType,
                        ...(blob.metadata.originalName && { filename: blob.metadata.originalName }),
                        source: blob.metadata.source || 'tool',
                        size: blob.metadata.size,
                        createdAt: blob.metadata.createdAt.toISOString(),
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
    };
}
