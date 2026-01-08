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
     * @param history The current conversation history.
     * @returns Summary messages to add to history (filterCompacted handles the rest).
     */
    compact(history: readonly InternalMessage[]): Promise<InternalMessage[]> | InternalMessage[];
}
