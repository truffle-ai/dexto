import { z } from 'zod';

/**
 * Schema for filesystem resource configuration
 */
const FileSystemResourceSchema = z.object({
    type: z.literal('filesystem'),
    paths: z.array(z.string()).describe('File paths or directories to expose as resources'),
});

/**
 * Union schema for all internal resource types
 */
const InternalResourceConfigSchema = FileSystemResourceSchema;

/**
 * Schema for internal resources configuration
 */
export const InternalResourcesSchema = z
    .object({
        enabled: z.boolean().default(false).describe('Whether internal resources are enabled'),
        resources: z
            .array(InternalResourceConfigSchema)
            .default([])
            .describe('Array of internal resource configurations'),
    })
    .strict()
    .default({})
    .describe('Configuration for internal resources with multiple types supported');

// Derive type from schema
export type InternalResourcesConfig = z.input<typeof InternalResourcesSchema>;
export type ValidatedInternalResourcesConfig = z.output<typeof InternalResourcesSchema>;
