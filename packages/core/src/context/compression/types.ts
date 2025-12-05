import { InternalMessage } from '../types.js';
import { ITokenizer } from '@core/llm/tokenizer/types.js';

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
     * @param tokenizer The tokenizer used to calculate message tokens.
     * @param maxTokens The maximum number of tokens allowed in the history.
     * @returns The potentially compressed message history.
     */
    compress(
        history: readonly InternalMessage[],
        tokenizer: ITokenizer,
        maxTokens: number
    ): Promise<InternalMessage[]> | InternalMessage[];
}
