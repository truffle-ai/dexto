import { z } from 'zod';

// TODO: (355) Agent: check this file for unused schemas and delete them
// https://github.com/truffle-ai/dexto/pull/355#discussion_r2412990031
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

/**
 * Blob metadata schema for validation
 */
export const BlobMetadataSchema = z
    .object({
        mimeType: z.string().optional().describe('MIME type of the blob content'),
        originalName: z.string().optional().describe('Original filename if available'),
        createdAt: z.date().optional().describe('Creation timestamp'),
        source: z.enum(['tool', 'user', 'system']).optional().describe('Source of the blob'),
        size: z.number().int().nonnegative().optional().describe('Size in bytes'),
    })
    .strict()
    .describe('Metadata associated with a blob');

/**
 * Stored blob metadata schema (complete metadata after storage)
 */
export const StoredBlobMetadataSchema = z
    .object({
        id: z.string().min(1).describe('Unique blob identifier'),
        mimeType: z.string().describe('Detected or provided MIME type'),
        originalName: z.string().optional().describe('Original filename if available'),
        createdAt: z.date().describe('Creation timestamp'),
        size: z.number().int().nonnegative().describe('Size in bytes'),
        hash: z.string().describe('Content hash for deduplication'),
        source: z.enum(['tool', 'user', 'system']).optional().describe('Source of the blob'),
    })
    .strict()
    .describe('Complete metadata for a stored blob');

/**
 * Blob reference schema
 */
export const BlobReferenceSchema = z
    .object({
        id: z.string().min(1).describe('Unique blob identifier'),
        uri: z.string().describe('Blob URI in blob:id format'),
        metadata: StoredBlobMetadataSchema.describe('Complete blob metadata'),
    })
    .strict()
    .describe('Reference to a stored blob');

/**
 * Blob statistics schema
 */
export const BlobStatsSchema = z
    .object({
        count: z.number().int().nonnegative().describe('Number of blobs stored'),
        totalSize: z.number().int().nonnegative().describe('Total size of all blobs in bytes'),
        backendType: z.string().describe('Type of storage backend'),
        storePath: z.string().describe('Storage path for local backend'),
    })
    .strict()
    .describe('Storage statistics');

// Type exports for convenience
// TODO: (355) Nit: use z.output, delete unused schemas
// https://github.com/truffle-ai/dexto/pull/355#discussion_r2412967958
export type ValidatedBlobServiceConfig = z.infer<typeof BlobServiceConfigSchema>;
export type ValidatedBlobMetadata = z.infer<typeof BlobMetadataSchema>;
export type ValidatedStoredBlobMetadata = z.infer<typeof StoredBlobMetadataSchema>;
export type ValidatedBlobReference = z.infer<typeof BlobReferenceSchema>;
export type ValidatedBlobStats = z.infer<typeof BlobStatsSchema>;
