import { InternalMessage } from '../types.js';

/**
 * Compaction strategy interface.
 *
 * Strategies are responsible for reducing conversation history size
 * when context limits are exceeded. The strategy is called by TurnExecutor
 * after detecting overflow via actual token usage from the API.
 */
export interface ICompactionStrategy {
    /** Human-readable name for logging/UI */
    readonly name: string;

    /**
     * Compacts the provided message history.
     *
     * The returned summary messages MUST include specific metadata fields for
     * `filterCompacted()` to correctly exclude pre-summary messages at read-time:
     *
     * Required metadata:
     * - `isSummary: true` - Marks the message as a compaction summary
     * - `originalMessageCount: number` - Count of messages that were summarized
     *   (used by filterCompacted to determine which messages to exclude)
     *
     * Optional metadata:
     * - `isRecompaction: true` - Set when re-compacting after a previous summary
     * - `isSessionSummary: true` - Alternative to isSummary for session-level summaries
     *
     * @param history The current conversation history.
     * @returns Summary messages to add to history. Empty array if nothing to compact.
     */
    compact(history: readonly InternalMessage[]): Promise<InternalMessage[]> | InternalMessage[];
}
