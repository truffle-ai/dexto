import { z } from 'zod';

/**
 * Unified hook factory entry configuration.
 *
 * Hooks are resolved via image factories, same pattern as tools:
 * - omit `hooks` entirely → use `image.defaults.hooks`
 * - specify `hooks` → full replace (arrays are atomic)
 * - each entry can set `enabled: false` to skip that entry entirely
 *
 * Additional fields are type-specific and validated by the resolver against the
 * image factory's `configSchema`.
 */
export const HookFactoryEntrySchema = z
    .object({
        type: z.string().describe('Hook factory type identifier'),
        enabled: z.boolean().optional().describe('If false, skip this hook entry entirely'),
    })
    .passthrough()
    .describe(
        'Hook factory configuration. Additional fields are type-specific and validated by the resolver.'
    );

export const HooksConfigSchema = z
    .array(HookFactoryEntrySchema)
    .describe('Hook configuration. Omit to use image defaults; provide to fully override.');

export type HooksConfig = z.input<typeof HooksConfigSchema>;
export type ValidatedHooksConfig = z.output<typeof HooksConfigSchema>;

export type HookFactoryEntry = z.output<typeof HookFactoryEntrySchema>;
