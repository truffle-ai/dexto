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
 * in the 'blobStorage' section of the agent config.
 */
const BlobResourceSchema = z
    .object({
        type: z.literal('blob').describe('Enable blob storage resource provider'),
    })
    .strict()
    .describe(
        'Blob resource provider configuration - actual storage settings are in blobStorage section'
    );

/**
 * Validated blob resource configuration type
 */
export type ValidatedBlobResourceConfig = z.output<typeof BlobResourceSchema>;

/**
 * Union schema for all internal resource types (composed from individual schemas)
 */
export const InternalResourceConfigSchema = z.discriminatedUnion('type', [
    FileSystemResourceSchema,
    BlobResourceSchema,
]);

/**
 * Validated union type for all internal resource configurations
 */
export type ValidatedInternalResourceConfig = z.output<typeof InternalResourceConfigSchema>;

/**
 * Schema for internal resources configuration with smart auto-enable logic
 *
 * Design principles:
 * - Clean input format: just specify resources array or object
 * - Auto-enable when resources are specified
 * - Backward compatibility with explicit enabled field
 * - Empty/omitted = disabled
 */
export const InternalResourcesSchema = z
    .union([
        z.array(InternalResourceConfigSchema), // array-only form
        z
            .object({
                enabled: z
                    .boolean()
                    .optional()
                    .describe('Explicit toggle; auto-enabled when resources are non-empty'),
                resources: z
                    .array(InternalResourceConfigSchema)
                    .default([])
                    .describe('List of internal resource configurations'),
            })
            .strict(),
    ])
    .default([])
    .describe(
        'Internal resource configuration. Can be an array of resources (auto-enabled) or object with enabled field'
    )
    .transform((input) => {
        if (Array.isArray(input)) {
            return { enabled: input.length > 0, resources: input };
        }
        const enabled = input.enabled !== undefined ? input.enabled : input.resources.length > 0;
        return { enabled, resources: input.resources };
    });

export type InternalResourcesConfig = z.input<typeof InternalResourcesSchema>;
export type ValidatedInternalResourcesConfig = z.output<typeof InternalResourcesSchema>;

export function isInternalResourcesEnabled(config: ValidatedInternalResourcesConfig): boolean {
    return config.enabled && config.resources.length > 0;
}
