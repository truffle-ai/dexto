import type { ICompactionStrategy } from '../types.js';
import type { InternalMessage } from '../../types.js';

/**
 * No-op compaction strategy that doesn't perform any compaction.
 *
 * Useful for:
 * - Testing without compaction overhead
 * - Disabling compaction temporarily
 * - Contexts where full history is required
 */
export class NoOpCompactionStrategy implements ICompactionStrategy {
    readonly name = 'noop';

    /**
     * Does nothing - returns empty array (no summary needed)
     */
    async compact(_history: readonly InternalMessage[]): Promise<InternalMessage[]> {
        return [];
    }
}
