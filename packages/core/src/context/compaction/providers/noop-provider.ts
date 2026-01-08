import { z } from 'zod';
import type { CompactionProvider } from '../provider.js';
import { NoOpCompactionStrategy } from '../strategies/noop.js';

/**
 * Configuration schema for no-op compaction
 */
export const NoOpConfigSchema = z
    .object({
        type: z.literal('noop'),
        enabled: z.boolean().default(true).describe('Enable or disable compaction'),
    })
    .strict();

export type NoOpConfig = z.output<typeof NoOpConfigSchema>;

/**
 * Provider for no-op compaction strategy.
 *
 * This strategy disables compaction entirely, keeping full conversation history.
 * Useful for testing, debugging, or contexts where full history is required.
 */
export const noopProvider: CompactionProvider<'noop', NoOpConfig> = {
    type: 'noop',
    configSchema: NoOpConfigSchema,
    metadata: {
        displayName: 'No Compaction',
        description: 'Disables compaction entirely, keeping full conversation history',
        requiresLLM: false,
        isProactive: false,
    },

    create(_config, _context) {
        return new NoOpCompactionStrategy();
    },
};
