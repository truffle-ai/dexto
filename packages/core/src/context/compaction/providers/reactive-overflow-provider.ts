import { z } from 'zod';
import type { CompactionProvider } from '../provider.js';
import { ReactiveOverflowStrategy } from '../strategies/reactive-overflow.js';

/**
 * Configuration schema for reactive overflow compaction
 */
export const ReactiveOverflowConfigSchema = z
    .object({
        type: z.literal('reactive-overflow'),
        enabled: z.boolean().default(true).describe('Enable or disable compaction'),
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
    .strict();

export type ReactiveOverflowConfig = z.output<typeof ReactiveOverflowConfigSchema>;

/**
 * Provider for reactive overflow compaction strategy.
 *
 * This strategy triggers compaction when context window overflow is detected:
 * - Generates LLM-powered summaries of older messages
 * - Preserves recent turns for context continuity
 * - Falls back to simple text summary if LLM call fails
 * - Adds summary message to history (read-time filtering excludes old messages)
 */
export const reactiveOverflowProvider: CompactionProvider<
    'reactive-overflow',
    ReactiveOverflowConfig
> = {
    type: 'reactive-overflow',
    configSchema: ReactiveOverflowConfigSchema,
    metadata: {
        displayName: 'Reactive Overflow Compaction',
        description: 'Generates summaries when context window overflows, preserving recent turns',
        requiresLLM: true,
        isProactive: false,
    },

    create(config, context) {
        if (!context.model) {
            throw new Error('ReactiveOverflowStrategy requires LanguageModel');
        }

        const options: import('../strategies/reactive-overflow.js').ReactiveOverflowOptions = {
            preserveLastNTurns: config.preserveLastNTurns,
            maxSummaryTokens: config.maxSummaryTokens,
        };

        if (config.summaryPrompt !== undefined) {
            options.summaryPrompt = config.summaryPrompt;
        }

        return new ReactiveOverflowStrategy(context.model, options, context.logger);
    },
};
