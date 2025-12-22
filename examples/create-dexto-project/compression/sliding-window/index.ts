/**
 * Example Compression Provider: Sliding Window
 *
 * Demonstrates how to create a custom compression provider that reduces
 * conversation history by keeping only the most recent messages.
 *
 * This is a simple strategy useful for demos - in production you'd likely
 * use the built-in LLM-based summarization strategies.
 */

import { z } from 'zod';
import type {
    CompressionProvider,
    CompressionContext,
    ICompressionStrategy,
    InternalMessage,
} from '@dexto/core';

/**
 * Configuration schema for the sliding window compression strategy
 */
const SlidingWindowConfigSchema = z
    .object({
        type: z.literal('sliding-window'),
        /** Number of recent messages to keep */
        windowSize: z
            .number()
            .int()
            .positive()
            .default(20)
            .describe('Number of recent messages to keep'),
        /** Whether to always keep the first system message */
        preserveSystemPrompt: z
            .boolean()
            .default(true)
            .describe('Always keep the first system message'),
        /** Add a summary marker when messages are removed */
        addSummaryMarker: z
            .boolean()
            .default(true)
            .describe('Add a marker indicating messages were compressed'),
    })
    .strict();

type SlidingWindowConfig = z.output<typeof SlidingWindowConfigSchema>;

/**
 * Sliding window compression strategy implementation
 */
class SlidingWindowStrategy implements ICompressionStrategy {
    readonly name = 'sliding-window';

    constructor(
        private config: SlidingWindowConfig,
        private context: CompressionContext
    ) {
        context.logger.debug('SlidingWindowStrategy initialized', {
            windowSize: config.windowSize,
            preserveSystemPrompt: config.preserveSystemPrompt,
        });
    }

    /**
     * Compress history by keeping only recent messages within the window.
     * Returns summary messages to add - the framework handles filtering.
     */
    compress(history: readonly InternalMessage[]): InternalMessage[] {
        const { windowSize, addSummaryMarker } = this.config;

        if (history.length <= windowSize) {
            this.context.logger.debug('History within window size, no compression needed');
            return [];
        }

        const messagesRemoved = history.length - windowSize;
        this.context.logger.info(`Compressing history: removing ${messagesRemoved} messages`);

        // Build the result - summary messages to add to history
        const result: InternalMessage[] = [];

        // Add a summary marker if enabled
        if (addSummaryMarker) {
            result.push({
                id: `compression-marker-${Date.now()}`,
                role: 'system',
                content: [
                    {
                        type: 'text',
                        text: `[${messagesRemoved} earlier messages were compressed to reduce context size]`,
                    },
                ],
                timestamp: Date.now(),
            });
        }

        return result;
    }
}

/**
 * Sliding window compression provider
 *
 * This provider creates a simple compression strategy that keeps only
 * the N most recent messages in the conversation history.
 *
 * Usage in agent YAML:
 * ```yaml
 * context:
 *   compression:
 *     type: sliding-window
 *     windowSize: 30
 *     preserveSystemPrompt: true
 *     addSummaryMarker: true
 * ```
 */
export const slidingWindowCompressionProvider: CompressionProvider<
    'sliding-window',
    SlidingWindowConfig
> = {
    type: 'sliding-window',
    configSchema: SlidingWindowConfigSchema,

    create(config, context) {
        return new SlidingWindowStrategy(config, context);
    },

    metadata: {
        displayName: 'Sliding Window',
        description: 'Keeps only the N most recent messages, discarding older ones',
        requiresLLM: false,
        isProactive: false,
    },
};
