import { z } from 'zod';

/**
 * Base compaction configuration schema.
 * Uses discriminated union to support different provider types.
 *
 * Each provider registers its own schema with specific validation rules.
 * This schema accepts any configuration with a 'type' field.
 */
export const CompactionConfigSchema = z
    .object({
        type: z.string().describe('Compaction provider type'),
        enabled: z.boolean().default(true).describe('Enable or disable compaction'),
        /**
         * Maximum context tokens before compaction triggers.
         * When set, overrides the model's context window for compaction threshold.
         * Useful for capping context size below the model's maximum limit.
         * Example: Set to 50000 to trigger compaction at 50K tokens even if
         * the model supports 200K tokens.
         */
        maxContextTokens: z
            .number()
            .positive()
            .optional()
            .describe(
                'Maximum context tokens before compaction triggers. Overrides model context window when set.'
            ),
        /**
         * Percentage of context window that triggers compaction (0.0 to 1.0).
         * Default is 1.0 (100%), meaning compaction triggers when context is full.
         * Set lower values to trigger compaction earlier.
         * Example: 0.8 triggers compaction when 80% of context is used.
         */
        thresholdPercent: z
            .number()
            .min(0.1)
            .max(1.0)
            .default(1.0)
            .describe(
                'Percentage of context window that triggers compaction (0.1 to 1.0, default 1.0)'
            ),
    })
    .passthrough() // Allow additional fields that will be validated by provider schemas
    .describe('Context compaction configuration');

export type CompactionConfigInput = z.output<typeof CompactionConfigSchema>;

/**
 * Default compaction configuration - uses reactive-overflow strategy
 */
export const DEFAULT_COMPACTION_CONFIG: CompactionConfigInput = {
    type: 'reactive-overflow',
    enabled: true,
    thresholdPercent: 1.0,
};
