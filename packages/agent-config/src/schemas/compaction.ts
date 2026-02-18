import { z } from 'zod';

const EnabledSchema = z.boolean().default(true).describe('Enable or disable compaction');

const MaxContextTokensSchema = z
    .number()
    .positive()
    .optional()
    .describe(
        "Maximum context tokens before compaction triggers. Caps the model's context window when set."
    );

const ThresholdPercentSchema = z
    .number()
    .min(0.1)
    .max(1.0)
    .default(0.9)
    .describe('Percentage of context window that triggers compaction (0.1 to 1.0, default 0.9)');

const CommonCompactionFields = {
    enabled: EnabledSchema,
    maxContextTokens: MaxContextTokensSchema,
    thresholdPercent: ThresholdPercentSchema,
} as const;

/**
 * Base compaction configuration schema.
 *
 * This validates the shared config fields used throughout the runtime (e.g.
 * `maxContextTokens` and `thresholdPercent`) and intentionally allows passthrough fields
 * for strategy-specific configuration.
 *
 * Strategy-specific validation happens in `resolveServicesFromConfig()` via each image
 * factory's `configSchema`.
 */
export const CompactionConfigSchema = z
    .object({
        type: z.string().describe('Compaction strategy type'),
        ...CommonCompactionFields,
    })
    .passthrough()
    .describe('Context compaction configuration');

export type CompactionConfig = z.input<typeof CompactionConfigSchema>;
export type ValidatedCompactionConfig = z.output<typeof CompactionConfigSchema>;

/**
 * Default compaction configuration - uses reactive-overflow strategy.
 */
export const DEFAULT_COMPACTION_CONFIG: ValidatedCompactionConfig = {
    type: 'reactive-overflow',
    enabled: true,
    thresholdPercent: 0.9,
};

export const ReactiveOverflowCompactionConfigSchema = z
    .object({
        type: z.literal('reactive-overflow'),
        ...CommonCompactionFields,
        preserveLastNTurns: z
            .number()
            .int()
            .positive()
            .default(2)
            .describe('Number of recent turns (user+assistant pairs) to preserve'),
        maxSummaryTokens: z
            .number()
            .int()
            .positive()
            .default(2000)
            .describe('Maximum tokens for the summary output'),
        summaryPrompt: z
            .string()
            .optional()
            .describe('Custom summary prompt template. Use {conversation} as placeholder'),
    })
    .strict()
    .describe('Reactive overflow compaction configuration');

export type ReactiveOverflowCompactionConfig = z.output<
    typeof ReactiveOverflowCompactionConfigSchema
>;

export const NoOpCompactionConfigSchema = z
    .object({
        type: z.literal('noop'),
        ...CommonCompactionFields,
    })
    .strict()
    .describe('No-op compaction configuration');

export type NoOpCompactionConfig = z.output<typeof NoOpCompactionConfigSchema>;
