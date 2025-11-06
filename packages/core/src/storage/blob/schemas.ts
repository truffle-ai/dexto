import { z } from 'zod';

export const BLOB_STORE_TYPES = ['in-memory', 'local'] as const;
export type BlobStoreType = (typeof BLOB_STORE_TYPES)[number];

/**
 * In-memory blob store configuration
 */
const InMemoryBlobStoreSchema = z
    .object({
        type: z.literal('in-memory').describe('Blob store type identifier'),
        maxBlobSize: z
            .number()
            .int()
            .positive()
            .optional()
            .default(10 * 1024 * 1024) // 10MB
            .describe('Maximum size per blob in bytes'),
        maxTotalSize: z
            .number()
            .int()
            .positive()
            .optional()
            .default(100 * 1024 * 1024) // 100MB
            .describe('Maximum total storage size in bytes'),
    })
    .strict();

export type InMemoryBlobStoreConfig = z.output<typeof InMemoryBlobStoreSchema>;

/**
 * Local filesystem blob store configuration
 */
const LocalBlobStoreSchema = z
    .object({
        type: z.literal('local').describe('Blob store type identifier'),
        storePath: z
            .string()
            .describe('Blob storage directory path (required - CLI enrichment provides per-agent default)'),
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
    })
    .strict();

export type LocalBlobStoreConfig = z.output<typeof LocalBlobStoreSchema>;

/**
 * Blob store configuration using discriminated union
 */
export const BlobStoreConfigSchema = z
    .discriminatedUnion('type', [InMemoryBlobStoreSchema, LocalBlobStoreSchema], {
        errorMap: (issue, ctx) => {
            if (issue.code === z.ZodIssueCode.invalid_union_discriminator) {
                return {
                    message: `Invalid blob store type. Expected 'in-memory' or 'local'.`,
                };
            }
            return { message: ctx.defaultError };
        },
    })
    .describe('Blob store configuration');

export type BlobStoreConfig = z.output<typeof BlobStoreConfigSchema>;
