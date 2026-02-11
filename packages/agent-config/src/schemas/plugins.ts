import { z } from 'zod';

/**
 * Unified plugin factory entry configuration.
 *
 * Plugins are resolved via image factories, same pattern as tools:
 * - omit `plugins` entirely → use `image.defaults.plugins`
 * - specify `plugins` → full replace (arrays are atomic)
 * - each entry can set `enabled: false` to skip that entry entirely
 *
 * Additional fields are type-specific and validated by the resolver against the
 * image factory's `configSchema`.
 */
export const PluginFactoryEntrySchema = z
    .object({
        type: z.string().describe('Plugin factory type identifier'),
        enabled: z.boolean().optional().describe('If false, skip this plugin entry entirely'),
    })
    .passthrough()
    .describe(
        'Plugin factory configuration. Additional fields are type-specific and validated by the resolver.'
    );

export const PluginsConfigSchema = z
    .array(PluginFactoryEntrySchema)
    .describe('Plugin configuration. Omit to use image defaults; provide to fully override.');

export type PluginsConfig = z.input<typeof PluginsConfigSchema>;
export type ValidatedPluginsConfig = z.output<typeof PluginsConfigSchema>;

export type PluginFactoryEntry = z.output<typeof PluginFactoryEntrySchema>;
