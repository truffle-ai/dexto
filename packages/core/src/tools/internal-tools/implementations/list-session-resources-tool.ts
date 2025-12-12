import { z } from 'zod';
import { InternalTool, ToolExecutionContext } from '../../types.js';
import type { ResourceManager } from '../../../resources/manager.js';

/**
 * Input schema for list_session_resources tool
 */
const ListSessionResourcesInputSchema = z
    .object({
        source: z
            .enum(['all', 'tool', 'user'])
            .optional()
            .default('all')
            .describe(
                'Filter resources by source: "tool" for tool-generated resources, "user" for user-uploaded resources, "all" for both'
            ),
        kind: z
            .enum(['all', 'image', 'audio', 'video', 'binary'])
            .optional()
            .default('all')
            .describe('Filter resources by type: "image", "audio", "video", "binary", or "all"'),
        limit: z
            .number()
            .optional()
            .default(50)
            .describe('Maximum number of resources to return (default: 50)'),
    })
    .strict();

type ListSessionResourcesInput = z.output<typeof ListSessionResourcesInputSchema>;

/**
 * Resource information returned to the agent
 *
 * IMPORTANT: The reference uses "blob:" prefix (not "@blob:") to avoid
 * triggering base64 expansion by expandBlobsInText() when this JSON
 * is serialized as a tool result. The agent should use this reference
 * with get_shareable_url tool.
 */
interface ResourceInfo {
    /** The blob reference (e.g., "blob:abc123") - use this with get_shareable_url */
    reference: string;
    /** Resource type (image, audio, video, binary) */
    kind: string;
    /** MIME type */
    mimeType: string;
    /** Original filename if available */
    filename?: string;
    /** Source of the resource */
    source: 'tool' | 'user' | 'system';
    /** Size in bytes */
    size: number;
    /** When the resource was created */
    createdAt: string;
}

/**
 * Internal tool for listing available resources in the current session.
 *
 * This tool allows agents to discover what resources (images, files, etc.) are
 * available for sharing. Use this when you need to find resources to share
 * with other agents or external systems.
 *
 * @example
 * ```typescript
 * // List all tool-generated images
 * list_session_resources({ source: 'tool', kind: 'image' })
 * → Returns list of image resources with their references
 *
 * // Get the reference, then use get_shareable_url to get a URL
 * get_shareable_url({ reference: '@blob:abc123' })
 * ```
 */
export function createListSessionResourcesTool(resourceManager: ResourceManager): InternalTool {
    return {
        id: 'list_session_resources',
        description:
            'List available resources (images, files, etc.) in the current session. ' +
            'Use this to discover resources that can be shared with other agents or external systems. ' +
            'Returns resource references (format: "blob:abc123") that can be used with get_shareable_url. ' +
            'Filter by source (tool/user) or kind (image/audio/video/binary).',
        inputSchema: ListSessionResourcesInputSchema,
        execute: async (input: unknown, _context?: ToolExecutionContext) => {
            const { source, kind, limit } = input as ListSessionResourcesInput;

            try {
                const blobStore = resourceManager.getBlobStore();
                const allBlobs = await blobStore.listBlobs();

                // Filter and transform blobs
                const resources: ResourceInfo[] = [];

                for (const blob of allBlobs) {
                    // Skip system resources (internal prompts, etc.)
                    if (blob.metadata.source === 'system') {
                        continue;
                    }

                    // Filter by source
                    if (source !== 'all' && blob.metadata.source !== source) {
                        continue;
                    }

                    // Determine resource kind from MIME type
                    const mimeType = blob.metadata.mimeType;
                    let resourceKind: 'image' | 'audio' | 'video' | 'binary' = 'binary';
                    if (mimeType.startsWith('image/')) resourceKind = 'image';
                    else if (mimeType.startsWith('audio/')) resourceKind = 'audio';
                    else if (mimeType.startsWith('video/')) resourceKind = 'video';

                    // Filter by kind
                    if (kind !== 'all' && resourceKind !== kind) {
                        continue;
                    }

                    // Use blob.uri without @ prefix to avoid expansion by expandBlobsInText()
                    resources.push({
                        reference: blob.uri,
                        kind: resourceKind,
                        mimeType: blob.metadata.mimeType,
                        ...(blob.metadata.originalName && { filename: blob.metadata.originalName }),
                        source: blob.metadata.source || 'tool',
                        size: blob.metadata.size,
                        createdAt: blob.metadata.createdAt.toISOString(),
                    });

                    if (resources.length >= limit) {
                        break;
                    }
                }

                // Sort by creation time (newest first)
                resources.sort(
                    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                );

                return {
                    success: true,
                    count: resources.length,
                    resources,
                    _hint:
                        resources.length > 0
                            ? 'Use get_shareable_url with a reference to get a shareable URL'
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
