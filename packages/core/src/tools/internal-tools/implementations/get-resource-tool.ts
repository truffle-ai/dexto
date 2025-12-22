import { z } from 'zod';
import { InternalTool, ToolExecutionContext } from '../../types.js';
import type { ResourceManager } from '../../../resources/manager.js';

/**
 * Input schema for get_resource tool
 */
const GetResourceInputSchema = z
    .object({
        reference: z
            .string()
            .describe(
                'The resource reference to access. Formats: "blob:abc123" (from list_resources), ' +
                    '"resource_ref:blob:abc123" (from tool annotations)'
            ),
        format: z
            .enum(['url', 'metadata'])
            .default('url')
            .describe(
                'Output format: "url" for a shareable URL (requires remote storage like Supabase), ' +
                    '"metadata" for resource information without loading the data'
            ),
    })
    .strict();

type GetResourceInput = z.output<typeof GetResourceInputSchema>;

/**
 * Internal tool for accessing resources.
 *
 * This tool provides access to stored resources (images, files, etc.) in formats
 * suitable for sharing or inspection, without loading binary data into context.
 *
 * Formats:
 * - `url`: Returns a shareable URL. Requires remote storage (e.g., Supabase).
 *          Local/memory storage does not support URL generation.
 * - `metadata`: Returns resource information (size, mimeType, filename, etc.)
 *               without loading the actual data.
 *
 * Design principle: Resources exist to keep binary data OUT of the context window.
 * This tool never returns base64 or raw data - use URLs for sharing instead.
 *
 * @example
 * ```typescript
 * // Get a shareable URL for an image
 * get_resource({ reference: 'blob:abc123', format: 'url' })
 * → { success: true, url: 'https://...', mimeType: 'image/png', ... }
 *
 * // Get metadata about a resource
 * get_resource({ reference: 'blob:abc123', format: 'metadata' })
 * → { success: true, mimeType: 'image/png', size: 12345, filename: '...', ... }
 * ```
 */
export function createGetResourceTool(resourceManager: ResourceManager): InternalTool {
    return {
        id: 'get_resource',
        description:
            'Access a stored resource. Use format "url" to get a shareable URL for other agents ' +
            'or external systems (requires remote storage like Supabase). Use format "metadata" ' +
            'to get resource information without loading data. ' +
            'References can be obtained from tool result annotations or list_resources.',
        inputSchema: GetResourceInputSchema,
        execute: async (input: unknown, _context?: ToolExecutionContext) => {
            const { reference, format } = input as GetResourceInput;

            try {
                const blobStore = resourceManager.getBlobStore();
                const storeType = blobStore.getStoreType();

                // Normalize the reference - handle various formats:
                // - "resource_ref:blob:abc123" (from tool annotations)
                // - "blob:abc123" (from list_resources)
                // - "abc123" (just the ID)
                let blobUri = reference;

                // Strip resource_ref: prefix if present
                if (blobUri.startsWith('resource_ref:')) {
                    blobUri = blobUri.substring('resource_ref:'.length);
                }

                // Strip @ prefix if present (legacy)
                if (blobUri.startsWith('@')) {
                    blobUri = blobUri.substring(1);
                }

                // Ensure it starts with blob:
                if (!blobUri.startsWith('blob:')) {
                    blobUri = `blob:${blobUri}`;
                }

                // Check if blob exists
                const exists = await blobStore.exists(blobUri);
                if (!exists) {
                    return {
                        success: false,
                        error: `Resource not found: ${reference}`,
                        _hint: 'Use list_resources to see available resources',
                    };
                }

                // Handle format: metadata
                if (format === 'metadata') {
                    // Get metadata without loading blob data by using listBlobs()
                    const allBlobs = await blobStore.listBlobs();
                    const blobRef = allBlobs.find((b) => b.uri === blobUri);

                    if (!blobRef) {
                        return {
                            success: false,
                            error: `Resource metadata not found: ${reference}`,
                            _hint: 'Use list_resources to see available resources',
                        };
                    }

                    return {
                        success: true,
                        format: 'metadata',
                        reference: blobUri,
                        mimeType: blobRef.metadata.mimeType,
                        size: blobRef.metadata.size,
                        filename: blobRef.metadata.originalName,
                        source: blobRef.metadata.source,
                        createdAt: blobRef.metadata.createdAt.toISOString(),
                    };
                }

                // Handle format: url
                // URL generation only supported for remote stores
                if (storeType === 'memory' || storeType === 'local') {
                    return {
                        success: false,
                        error: 'URL generation not available with local/memory storage',
                        _hint:
                            'Configure remote storage (e.g., Supabase) in your agent config to enable ' +
                            'URL sharing. Local storage cannot generate shareable URLs.',
                        storeType,
                    };
                }

                // For Supabase and other remote stores, generate URL
                const blob = await blobStore.retrieve(blobUri, 'url');

                return {
                    success: true,
                    format: 'url',
                    url: blob.data,
                    reference: blobUri,
                    mimeType: blob.metadata.mimeType,
                    size: blob.metadata.size,
                    filename: blob.metadata.originalName,
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return {
                    success: false,
                    error: `Failed to access resource: ${message}`,
                };
            }
        },
    };
}
