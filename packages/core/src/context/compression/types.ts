import { InternalMessage } from '../types.js';
import { ITokenizer } from '@core/llm/tokenizer/types.js';

/**
 * Defines the contract for a strategy used to compress a conversation history
 * to fit within a maximum token limit.
 */
export interface ICompressionStrategy {
    /**
     * Compresses the provided message history.
     *
     * @param history The current conversation history.
     * @param tokenizer The tokenizer used to calculate message tokens.
     * @param maxInputTokens The maximum number of tokens allowed in the history.
     * @returns The potentially compressed message history.
     */
    compress(
        history: InternalMessage[],
        tokenizer: ITokenizer,
        maxInputTokens: number
    ): InternalMessage[];
}
