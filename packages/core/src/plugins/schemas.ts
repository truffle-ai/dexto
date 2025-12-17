import { z } from 'zod';

/**
 * Schema for registry-based plugin configuration.
 * These plugins are loaded from the pluginRegistry (programmatically registered).
 */
export const RegistryPluginConfigSchema = z
    .object({
        type: z.string().describe('Plugin provider type (must be registered in pluginRegistry)'),
        enabled: z.boolean().default(true).describe('Whether this plugin is enabled'),
        blocking: z.boolean().describe('If true, plugin errors will halt execution'),
        priority: z.number().int().describe('Execution priority (lower runs first)'),
        config: z.record(z.any()).optional().describe('Plugin-specific configuration'),
    })
    .strict();

export type RegistryPluginConfig = z.output<typeof RegistryPluginConfigSchema>;

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
            .describe('Array of custom plugin configurations (loaded from file paths)'),

        // Registry plugins - array of plugin configurations (loaded from pluginRegistry)
        registry: z
            .array(RegistryPluginConfigSchema)
            .default([])
            .describe('Array of registry plugin configurations (loaded from pluginRegistry)'),
    })
    .strict()
    .default({
        custom: [],
        registry: [],
    })
    .describe('Plugin system configuration');

export type PluginsConfig = z.input<typeof PluginsConfigSchema>;
export type ValidatedPluginsConfig = z.output<typeof PluginsConfigSchema>;
