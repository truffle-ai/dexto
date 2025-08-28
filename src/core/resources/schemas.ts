import { z } from 'zod';

/**
 * Schema for validating file extensions (must start with a dot)
 */
const FileExtensionSchema = z
    .string()
    .regex(
        /^\.[a-zA-Z0-9]+$/,
        'File extensions must start with a dot and contain only alphanumeric characters'
    );

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
 * Union schema for all internal resource types
 */
export const InternalResourceConfigSchema = FileSystemResourceSchema;

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
        // New clean format: just an array of resources
        z.array(InternalResourceConfigSchema),
        // Legacy format: object with enabled field
        z
            .object({
                enabled: z.boolean().optional(),
                resources: z.array(InternalResourceConfigSchema).default([]),
            })
            .strict(),
    ])
    .default([])
    .describe(
        'Internal resource configuration. Can be an array of resources (auto-enabled) or object with enabled field'
    )
    .transform((input) => {
        // Handle array input (new clean format)
        if (Array.isArray(input)) {
            return {
                enabled: input.length > 0,
                resources: input,
            };
        }

        // Handle object input (legacy format with auto-enable logic)
        const enabled = input.enabled !== undefined ? input.enabled : input.resources.length > 0;
        return {
            enabled,
            resources: input.resources,
        };
    });

// Derive types from schema
export type InternalResourcesConfig = z.input<typeof InternalResourcesSchema>;
export type ValidatedInternalResourcesConfig = z.output<typeof InternalResourcesSchema>;

/**
 * Helper function to check if internal resources are enabled
 */
export function isInternalResourcesEnabled(config: ValidatedInternalResourcesConfig): boolean {
    return config.enabled && config.resources.length > 0;
}
