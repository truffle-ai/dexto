import { InternalMessage } from '../types.js';

/**
 * Compression strategy interface.
 *
 * Strategies are responsible for reducing conversation history size
 * when context limits are exceeded. The strategy is called by TurnExecutor
 * after detecting overflow via actual token usage from the API.
 */
export interface ICompressionStrategy {
    /** Human-readable name for logging/UI */
    readonly name: string;

    /**
     * Compresses the provided message history.
     *
     * @param history The current conversation history.
     * @returns Summary messages to add to history (filterCompacted handles the rest).
     */
    compress(history: readonly InternalMessage[]): Promise<InternalMessage[]> | InternalMessage[];
}
