import { z } from 'zod';
import type { Tool, ToolExecutionContext } from '@dexto/core';
import { ToolError } from '@dexto/core';

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

export function createGetResourceTool(): Tool {
    return {
        id: 'get_resource',
        description:
            'Access a stored resource. Use format "url" to get a shareable URL for other agents ' +
            'or external systems (requires remote storage like Supabase). Use format "metadata" ' +
            'to get resource information without loading data. ' +
            'References can be obtained from tool result annotations or list_resources.',
        inputSchema: GetResourceInputSchema,
        execute: async (input: unknown, context: ToolExecutionContext) => {
            const { reference, format } = input as GetResourceInput;

            const resourceManager = context.services?.resources;
            if (!resourceManager) {
                throw ToolError.configInvalid(
                    'get_resource requires ToolExecutionContext.services.resources'
                );
            }

            try {
                const blobStore = resourceManager.getBlobStore();
                const storeType = blobStore.getStoreType();

                let blobUri = reference;

                if (blobUri.startsWith('resource_ref:')) {
                    blobUri = blobUri.substring('resource_ref:'.length);
                }

                if (blobUri.startsWith('@')) {
                    blobUri = blobUri.substring(1);
                }

                if (!blobUri.startsWith('blob:')) {
                    blobUri = `blob:${blobUri}`;
                }

                const exists = await blobStore.exists(blobUri);
                if (!exists) {
                    return {
                        success: false,
                        error: `Resource not found: ${reference}`,
                        _hint: 'Use list_resources to see available resources',
                    };
                }

                if (format === 'metadata') {
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
