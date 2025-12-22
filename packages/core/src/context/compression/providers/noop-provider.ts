import { z } from 'zod';
import type { CompressionProvider } from '../provider.js';
import { NoOpCompressionStrategy } from '../strategies/noop.js';

/**
 * Configuration schema for no-op compression
 */
export const NoOpConfigSchema = z
    .object({
        type: z.literal('noop'),
        enabled: z.boolean().default(true).describe('Enable or disable compression'),
    })
    .strict();

export type NoOpConfig = z.output<typeof NoOpConfigSchema>;

/**
 * Provider for no-op compression strategy.
 *
 * This strategy disables compression entirely, keeping full conversation history.
 * Useful for testing, debugging, or contexts where full history is required.
 */
export const noopProvider: CompressionProvider<'noop', NoOpConfig> = {
    type: 'noop',
    configSchema: NoOpConfigSchema,
    metadata: {
        displayName: 'No Compression',
        description: 'Disables compression entirely, keeping full conversation history',
        requiresLLM: false,
        isProactive: false,
    },

    create(_config, _context) {
        return new NoOpCompressionStrategy();
    },
};
