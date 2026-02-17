import { z } from 'zod';

/**
 * Schema for validating file extensions (must start with a dot)
 */
const FileExtensionSchema = z
    .string()
    .regex(
        /^\.[A-Za-z0-9][A-Za-z0-9._-]*$/,
        'Extensions must start with a dot and may include alphanumerics, dot, underscore, or hyphen (e.g., .d.ts, .tar.gz)'
    )
    .describe('File extension pattern starting with a dot; supports multi-part extensions');

/**
 * Schema for filesystem resource configuration
 */
const FileSystemResourceSchema = z
    .object({
        type: z.literal('filesystem'),
        paths: z
            .array(z.string())
            .min(1)
            .describe('File paths or directories to expose as resources (at least one required)'),
        maxDepth: z
            .number()
            .min(1)
            .max(10)
            .default(3)
            .describe('Maximum directory depth to traverse (default: 3)'),
        maxFiles: z
            .number()
            .min(1)
            .max(10000)
            .default(1000)
            .describe('Maximum number of files to include (default: 1000)'),
        includeHidden: z
            .boolean()
            .default(false)
            .describe('Include hidden files and directories (default: false)'),
        includeExtensions: z
            .array(FileExtensionSchema)
            .default([
                '.txt',
                '.md',
                '.js',
                '.ts',
                '.json',
                '.html',
                '.css',
                '.py',
                '.yaml',
                '.yml',
                '.xml',
                '.jsx',
                '.tsx',
                '.vue',
                '.php',
                '.rb',
                '.go',
                '.rs',
                '.java',
                '.kt',
                '.swift',
                '.sql',
                '.sh',
                '.bash',
                '.zsh',
            ])
            .describe('File extensions to include (default: common text files)'),
    })
    .strict();

/**
 * Validated filesystem resource configuration type
 */
export type ValidatedFileSystemResourceConfig = z.output<typeof FileSystemResourceSchema>;

/**
 * Schema for blob storage resource configuration
 *
 * NOTE: This only enables the blob resource provider.
 * Actual blob storage settings (size limits, backend, cleanup) are configured
 * in the 'storage.blob' section of the agent config.
 */
const BlobResourceSchema = z
    .object({
        type: z.literal('blob').describe('Enable blob storage resource provider'),
    })
    .strict()
    .describe(
        'Blob resource provider configuration - actual storage settings are in storage.blob section'
    );

/**
 * Validated blob resource configuration type
 */
export type ValidatedBlobResourceConfig = z.output<typeof BlobResourceSchema>;

/**
 * Union schema for all internal resource types (composed from individual schemas)
 */
export const ResourceConfigSchema = z.discriminatedUnion('type', [
    FileSystemResourceSchema,
    BlobResourceSchema,
]);

/**
 * Validated union type for all internal resource configurations
 */
export type ValidatedResourceConfig = z.output<typeof ResourceConfigSchema>;

/**
 * Schema for agent-managed resources (filesystem, blob, etc.).
 *
 * Omit or set to [] to disable agent-managed resources.
 */
export const ResourcesConfigSchema = z
    .array(ResourceConfigSchema)
    .default([])
    .describe('Agent-managed resource configuration');

export type ResourcesConfig = z.input<typeof ResourcesConfigSchema>;
export type ValidatedResourcesConfig = z.output<typeof ResourcesConfigSchema>;
