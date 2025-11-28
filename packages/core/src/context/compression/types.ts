import { InternalMessage } from '../types.js';
import { ITokenizer } from '@core/llm/tokenizer/types.js';

/**
 * When to trigger compression check
 */
export type CompressionTrigger =
    | { type: 'threshold'; percentage: number } // e.g., 80% of context
    | { type: 'overflow' } // After actual overflow (OpenCode style)
    | { type: 'manual' }; // Only on explicit request

/**
 * Compression strategy interface (v2)
 * Replaces the old synchronous interface with an async one that supports
 * reactive compression based on actual token usage.
 */
export interface ICompressionStrategy {
    /** Human-readable name for logging/UI */
    readonly name: string;

    /** When this strategy should be triggered */
    readonly trigger: CompressionTrigger;

    /**
     * Compresses the provided message history.
     *
     * @param history The current conversation history.
     * @param tokenizer The tokenizer used to calculate message tokens.
     * @param maxTokens The maximum number of tokens allowed in the history.
     * @returns The potentially compressed message history.
     */
    compress(
        history: InternalMessage[],
        tokenizer: ITokenizer,
        maxTokens: number
    ): Promise<InternalMessage[]> | InternalMessage[];

    /** Optional: validate compression was effective */
    validate?(before: number, after: number): boolean;
}
