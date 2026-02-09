import { z } from 'zod';

/**
 * Schema for registry-based plugin configuration.
 * Deprecated: registry-based plugins are being removed in favor of image-provided plugins.
 */
export const RegistryPluginConfigSchema = z
    .object({
        type: z
            .string()
            .describe(
                'Deprecated: registry plugin provider type. Use image-provided plugins instead.'
            ),
        enabled: z.boolean().default(true).describe('Whether this plugin is enabled'),
        blocking: z.boolean().describe('If true, plugin errors will halt execution'),
        priority: z.number().int().describe('Execution priority (lower runs first)'),
        config: z.record(z.any()).optional().describe('Plugin-specific configuration'),
    })
    .strict();

export type RegistryPluginConfig = z.output<typeof RegistryPluginConfigSchema>;

/**
 * Schema for custom plugin configuration (loaded from file paths)
 * Deprecated: file-based plugins are being removed in favor of image-provided plugins.
 */
export const CustomPluginConfigSchema = z
    .object({
        name: z.string().describe('Unique name for the plugin'),
        module: z
            .string()
            .describe(
                'Deprecated: absolute path to plugin module (use images instead of file-based plugins)'
            ),
        enabled: z.boolean().default(true).describe('Whether this plugin is enabled'),
        blocking: z.boolean().describe('If true, plugin errors will halt execution'),
        priority: z.number().int().describe('Execution priority (lower runs first)'),
        config: z.record(z.any()).optional().describe('Plugin-specific configuration'),
    })
    .strict();

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
 * Supports built-in plugins (by name), custom plugins (file paths), and registry plugins (programmatic)
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

        // Custom plugins - array of plugin configurations (loaded from file paths)
        custom: z
            .array(CustomPluginConfigSchema)
            .default([])
            .describe('Deprecated: array of custom plugin configurations (file-based plugins)'),

        // Registry plugins - array of plugin configurations (programmatic registration)
        registry: z
            .array(RegistryPluginConfigSchema)
            .default([])
            .describe('Deprecated: array of registry plugin configurations (programmatic plugins)'),
    })
    .strict()
    .default({
        custom: [],
        registry: [],
    })
    .describe('Plugin system configuration');

export type PluginsConfig = z.input<typeof PluginsConfigSchema>;
export type ValidatedPluginsConfig = z.output<typeof PluginsConfigSchema>;
