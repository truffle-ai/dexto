import { z } from 'zod';

/**
 * Schema for custom plugin configuration (loaded from file paths)
 */
export const CustomPluginConfigSchema = z
    .object({
        name: z.string().describe('Unique name for the plugin'),
        module: z
            .string()
            .describe(
                'Absolute path to plugin module (use ${{dexto.agent_dir}} for agent-relative paths)'
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
 * Supports both built-in plugins (by name) and custom plugins (with module paths)
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

        // Custom plugins - array of plugin configurations
        custom: z
            .array(CustomPluginConfigSchema)
            .default([])
            .describe('Array of custom plugin configurations'),
    })
    .strict()
    .default({
        custom: [],
    })
    .describe('Plugin system configuration');

export type PluginsConfig = z.input<typeof PluginsConfigSchema>;
export type ValidatedPluginsConfig = z.output<typeof PluginsConfigSchema>;
