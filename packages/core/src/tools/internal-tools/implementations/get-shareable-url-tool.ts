import { z } from 'zod';
import { InternalTool, ToolExecutionContext } from '../../types.js';
import type { ResourceManager } from '../../../resources/manager.js';
import { DextoRuntimeError, ErrorScope, ErrorType } from '../../../errors/index.js';

/**
 * Input schema for get_shareable_url tool
 */
const GetShareableUrlInputSchema = z
    .object({
        reference: z
            .string()
            .describe(
                'The resource reference to get a shareable URL for. Accepts formats: ' +
                    '"resource_ref:blob:abc123" (from tool annotations), "blob:abc123" (from list_session_resources), ' +
                    'or just the ID "abc123"'
            ),
        expiresIn: z
            .number()
            .optional()
            .default(3600)
            .describe(
                'URL expiry time in seconds (default: 3600 = 1 hour). Only applies to remote storage backends like Supabase.'
            ),
    })
    .strict();

type GetShareableUrlInput = z.output<typeof GetShareableUrlInputSchema>;

/**
 * Internal tool for getting a shareable URL for a resource.
 *
 * This tool converts a blob reference into a shareable URL that can be
 * included in responses to other agents or external systems.
 *
 * Behavior varies by storage backend:
 * - **Supabase**: Returns a signed URL with configurable expiry (default: 1 hour)
 * - **Local/Memory**: Returns an error as URL sharing is not supported
 *
 * @example
 * ```typescript
 * // After a tool generates an image, you'll see:
 * // [Resource: @blob:abc123 (image, image/png)]
 *
 * // Get a shareable URL for that resource:
 * get_shareable_url({ reference: '@blob:abc123' })
 * → { success: true, url: 'https://...signed-url...', expiresAt: '...' }
 *
 * // Include the URL in your response to share the resource
 * ```
 */
export function createGetShareableUrlTool(resourceManager: ResourceManager): InternalTool {
    return {
        id: 'get_shareable_url',
        description:
            'Get a shareable URL for a resource. Use this when you need to share an image, file, ' +
            'or other resource with another agent or external system. The reference can be obtained ' +
            'from tool result annotations (format: "resource_ref:blob:abc123") or from list_session_resources ' +
            '(format: "blob:abc123"). Pass the reference to this tool to get a shareable URL. ' +
            'Note: URL sharing requires a remote storage backend (e.g., Supabase). ' +
            'Local storage returns base64 data instead.',
        inputSchema: GetShareableUrlInputSchema,
        execute: async (input: unknown, _context?: ToolExecutionContext) => {
            const { reference, expiresIn } = input as GetShareableUrlInput;

            try {
                const blobStore = resourceManager.getBlobStore();
                const storeType = blobStore.getStoreType();

                // Normalize the reference - handle various formats:
                // - "resource_ref:blob:abc123" (from tool annotations)
                // - "blob:abc123" (from list_session_resources)
                // - "@blob:abc123" (legacy format)
                // - "abc123" (just the ID)
                let blobUri = reference;

                // Strip resource_ref: prefix if present
                if (blobUri.startsWith('resource_ref:')) {
                    blobUri = blobUri.substring('resource_ref:'.length);
                }

                // Strip @ prefix if present
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
                        _hint: 'Use list_session_resources to see available resources',
                    };
                }

                // Check storage type - URL generation only supported for remote stores
                if (storeType === 'memory' || storeType === 'local') {
                    // For local/memory stores, we can't generate a URL
                    // Return base64 data instead as a fallback
                    const blob = await blobStore.retrieve(blobUri, 'base64');

                    return {
                        success: true,
                        format: 'base64',
                        data: blob.data,
                        mimeType: blob.metadata.mimeType,
                        filename: blob.metadata.originalName,
                        size: blob.metadata.size,
                        _hint:
                            'URL sharing is not available with local/memory storage. ' +
                            'Base64 data is returned instead. Configure Supabase storage for URL support.',
                    };
                }

                // For Supabase and other remote stores, generate a signed URL
                const blob = await blobStore.retrieve(blobUri, 'url');

                // Calculate expiry time
                const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

                return {
                    success: true,
                    format: 'url',
                    url: blob.data,
                    mimeType: blob.metadata.mimeType,
                    filename: blob.metadata.originalName,
                    size: blob.metadata.size,
                    expiresAt,
                    expiresInSeconds: expiresIn,
                    _hint: `URL is valid for ${Math.round(expiresIn / 60)} minutes. Include this URL in your response to share the resource.`,
                };
            } catch (error) {
                // Check for specific error types
                if (error instanceof DextoRuntimeError) {
                    throw error;
                }

                const message = error instanceof Error ? error.message : String(error);

                // Check if it's an unsupported format error (e.g., local store doesn't support URL)
                if (message.includes('not supported') || message.includes('Path format')) {
                    return {
                        success: false,
                        error: 'URL generation not supported by current storage backend',
                        _hint: 'Configure Supabase storage for URL support, or the base64 data will be returned for local/memory storage.',
                    };
                }

                throw new DextoRuntimeError(
                    `Failed to get shareable URL: ${message}`,
                    ErrorScope.TOOLS,
                    ErrorType.SYSTEM,
                    'SHAREABLE_URL_ERROR'
                );
            }
        },
    };
}
