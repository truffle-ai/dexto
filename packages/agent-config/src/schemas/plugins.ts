import { z } from 'zod';

/**
 * Schema for built-in plugin configuration
 * Built-in plugins don't need module paths - they're referenced by name
 */
export const BuiltInPluginConfigSchema = z
    .object({
        priority: z.number().int().describe('Execution priority (lower runs first)'),
        blocking: z.boolean().optional().describe('If true, plugin errors will halt execution'),
        enabled: z.boolean().default(true).describe('Whether this plugin is enabled'),
        // Plugin-specific config fields are defined per-plugin
    })
    .passthrough() // Allow additional fields for plugin-specific config
    .describe('Configuration for a built-in plugin');

/**
 * Main plugins configuration schema
 * Supports built-in plugins (by name) only.
 */
export const PluginsConfigSchema = z
    .object({
        // Built-in plugins - referenced by name
        contentPolicy: BuiltInPluginConfigSchema.optional().describe(
            'Content policy plugin for input validation and sanitization'
        ),
        responseSanitizer: BuiltInPluginConfigSchema.optional().describe(
            'Response sanitizer plugin for output sanitization'
        ),
    })
    .strict()
    .default({})
    .describe('Plugin system configuration');

export type PluginsConfig = z.input<typeof PluginsConfigSchema>;
export type ValidatedPluginsConfig = z.output<typeof PluginsConfigSchema>;
