/**
 * Supabase blob store provider for CLI layer.
 *
 * This provider lives entirely in the CLI layer to keep the @supabase/supabase-js
 * dependency optional. Only applications that need Supabase storage will bundle
 * this dependency.
 *
 * Includes:
 * - Configuration schema and type
 * - Implementation (SupabaseBlobStore)
 * - Provider registration
 */

import type { BlobStoreProvider } from '@dexto/core';
import { z } from 'zod';
import { SupabaseBlobStore } from './supabase-blob-store.js';

/**
 * Supabase blob store configuration schema
 */
export const SupabaseBlobStoreSchema = z
    .object({
        type: z.literal('supabase').describe('Blob store type identifier'),
        supabaseUrl: z
            .string()
            .url()
            .describe('Supabase project URL (e.g., https://xxxxx.supabase.co)'),
        supabaseKey: z.string().describe('Supabase anon or service role key'),
        bucket: z.string().describe('Storage bucket name (must exist in Supabase project)'),
        pathPrefix: z
            .string()
            .optional()
            .describe('Optional path prefix within bucket for organizing blobs'),
        public: z
            .boolean()
            .optional()
            .default(false)
            .describe(
                'If true, generate public URLs instead of signed URLs. ' +
                    'Only works if the bucket is configured as public in Supabase.'
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
            .describe(
                'Maximum total storage size in bytes (informational - not enforced by Supabase)'
            ),
        cleanupAfterDays: z
            .number()
            .int()
            .positive()
            .optional()
            .default(30)
            .describe('Auto-cleanup blobs older than N days'),
        tableName: z
            .string()
            .optional()
            .default('blob_metadata')
            .describe('Database table name for blob metadata'),
    })
    .strict();

export type SupabaseBlobStoreConfig = z.output<typeof SupabaseBlobStoreSchema>;

/**
 * Supabase blob store provider.
 *
 * This provider enables remote blob storage using Supabase Storage and Database.
 * It's ideal for cloud deployments and distributed systems.
 *
 * Setup requirements:
 * 1. Create a Supabase project at https://supabase.com
 * 2. Create a storage bucket (must match the 'bucket' config value)
 * 3. Create the metadata table using the SQL from SupabaseBlobStore docs
 * 4. Optionally configure Row Level Security (RLS) policies
 *
 * Features:
 * - Remote cloud storage
 * - Content-based deduplication
 * - Signed or public URLs
 * - Automatic cleanup
 * - Metadata persistence in Postgres
 */
export const supabaseBlobStoreProvider: BlobStoreProvider<'supabase', SupabaseBlobStoreConfig> = {
    type: 'supabase',
    configSchema: SupabaseBlobStoreSchema,
    create: (config, logger) => new SupabaseBlobStore(config, logger),
    metadata: {
        displayName: 'Supabase Storage',
        description: 'Store blobs in Supabase cloud storage with Postgres metadata',
        requiresNetwork: true,
    },
};
