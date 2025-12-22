import type { ICompressionStrategy } from '../types.js';
import type { InternalMessage } from '../../types.js';

/**
 * No-op compression strategy that doesn't perform any compression.
 *
 * Useful for:
 * - Testing without compression overhead
 * - Disabling compression temporarily
 * - Contexts where full history is required
 */
export class NoOpCompressionStrategy implements ICompressionStrategy {
    readonly name = 'noop';

    /**
     * Does nothing - returns empty array (no summary needed)
     */
    async compress(_history: readonly InternalMessage[]): Promise<InternalMessage[]> {
        return [];
    }
}
