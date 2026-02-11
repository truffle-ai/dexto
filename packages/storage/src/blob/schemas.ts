import { z } from 'zod';

/**
 * Built-in blob store types (core providers only).
 * Custom providers shipped via images are not included in this list.
 */
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
            .describe(
                'Blob storage directory path (required for local storage - CLI enrichment provides per-agent default)'
            ),
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
 * Blob store configuration schema.
 *
 * This schema uses `.passthrough()` to accept any provider-specific configuration.
 * It only validates that a `type` field exists as a string.
 *
 * Detailed validation happens in the product-layer resolver (`@dexto/agent-config`) via
 * each image factory's `configSchema`. Built-in providers are validated in `createBlobStore()`.
 *
 * This approach allows:
 * - Custom providers to be provided by a custom image
 * - Each provider to define its own configuration structure and strict schema
 *
 * Example flow:
 * 1. Config passes this schema (basic structure check)
 * 2. Product layer resolves provider via image + validates against provider schema
 * 3. Core receives a concrete `BlobStore` instance (DI)
 */
export const BlobStoreConfigSchema = z
    .object({
        type: z.string().describe('Blob store provider type'),
    })
    .passthrough()
    .describe('Blob store configuration (validated by image factory)');

/**
 * Blob store configuration type.
 *
 * Union type including built-in providers (local, in-memory) and a catch-all
 * for custom providers registered at runtime.
 */
export type BlobStoreConfig =
    | InMemoryBlobStoreConfig
    | LocalBlobStoreConfig
    | { type: string; [key: string]: unknown }; // Custom provider configs

// Export individual schemas for use in providers
export { InMemoryBlobStoreSchema, LocalBlobStoreSchema };
