import { z } from 'zod';

/**
 * Base blob backend configuration schema
 */
const BlobBackendConfigSchema = z.object({
    maxBlobSize: z
        .number()
        .int()
        .positive()
        .optional()
        .default(50 * 1024 * 1024) // 50MB
        .describe('Maximum size per blob in bytes'),
    maxTotalSize: z
        .number()
        .int()
        .positive()
        .optional()
        .default(1024 * 1024 * 1024) // 1GB
        .describe('Maximum total storage size in bytes'),
    cleanupAfterDays: z
        .number()
        .int()
        .positive()
        .optional()
        .default(30)
        .describe('Auto-cleanup blobs older than N days'),
});

/**
 * Local filesystem backend configuration
 */
export const BlobServiceConfigSchema = BlobBackendConfigSchema.extend({
    type: z.literal('local').describe('Backend type identifier'),
    storePath: z
        .string()
        .optional()
        .describe('Custom storage path (defaults to context-aware path)'),
})
    .strict()
    .describe('Blob storage backend configuration');

// Type exports for convenience
export type ValidatedBlobServiceConfig = z.output<typeof BlobServiceConfigSchema>;
