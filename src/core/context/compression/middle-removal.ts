import { ITokenizer } from '@core/llm/tokenizer/types.js';
import { InternalMessage } from '@core/context/types.js';
import { ICompressionStrategy } from './types.js';
import { countMessagesTokens } from '@core/context/utils.js';
import { ContextError } from '../errors.js';

/**
 * Configuration options for the MiddleRemovalStrategy.
 */
export interface MiddleRemovalStrategyOptions {
    /**
     * The number of messages to preserve at the beginning of the history.
     * @default 4
     */
    preserveStart?: number;
    /**
     * The number of messages to preserve at the end of the history.
     * @default 5
     */
    preserveEnd?: number;
}

/**
 * Implements a compression strategy that removes messages from the middle of the
 * conversation history, preserving a configurable number of messages at the
 * beginning and end. It prioritizes removing the oldest messages within the
 * removable middle section first.
 */
export class MiddleRemovalStrategy implements ICompressionStrategy {
    private readonly preserveStart: number;
    private readonly preserveEnd: number;

    /**
     * Creates an instance of MiddleRemovalStrategy.
     *
     * @param options Configuration options for preserving messages.
     */
    constructor(options: MiddleRemovalStrategyOptions = {}) {
        this.preserveStart = options.preserveStart ?? 4;
        this.preserveEnd = options.preserveEnd ?? 5;

        if (this.preserveStart < 0 || this.preserveEnd < 0) {
            throw ContextError.preserveValuesNegative();
        }
    }

    /**
     * Compresses the history by removing messages from the middle if the total
     * token count exceeds the specified maximum.
     *
     * @param history The current conversation history.
     * @param tokenizer The tokenizer used to calculate message tokens.
     * @param maxHistoryTokens The maximum number of tokens allowed *for the history messages*.
     * @returns The potentially compressed message history.
     */
    compress(
        history: InternalMessage[],
        tokenizer: ITokenizer,
        maxHistoryTokens: number
    ): InternalMessage[] {
        const initialTokenCount = countMessagesTokens(history, tokenizer);

        if (initialTokenCount <= maxHistoryTokens) {
            return history; // No compression needed
        }

        const removableIndices: number[] = [];
        const totalMessages = history.length;

        // Identify indices of messages that can be removed
        // Ensure preserveStart + preserveEnd doesn't exceed total messages
        if (totalMessages > this.preserveStart + this.preserveEnd) {
            for (let i = this.preserveStart; i < totalMessages - this.preserveEnd; i++) {
                removableIndices.push(i);
            }
        } else {
            // Not enough messages to perform middle removal based on preserve counts
            console.warn(
                'MiddleRemovalStrategy: Not enough messages to apply middle removal based on preserve counts. History length:',
                totalMessages,
                'PreserveStart:',
                this.preserveStart,
                'PreserveEnd:',
                this.preserveEnd
            );
            return history; // Cannot compress further with this strategy under these constraints
        }

        let currentHistory = [...history];
        let currentTokenCount = initialTokenCount;
        const removedIndices = new Set<number>(); // Keep track of originally indexed items removed

        // Remove messages starting from the oldest in the middle section
        while (currentTokenCount > maxHistoryTokens && removableIndices.length > 0) {
            const indexToRemove = removableIndices.shift()!; // Oldest removable index
            removedIndices.add(indexToRemove); // Track original index

            // Use the utility function again to recount tokens for the filtered history
            currentTokenCount = countMessagesTokens(
                currentHistory.filter((_, i) => !removedIndices.has(i)), // Calculate tokens based on remaining messages
                tokenizer
            );
        }

        if (currentTokenCount > maxHistoryTokens) {
            console.warn(
                `MiddleRemovalStrategy: Unable to compress below max tokens (${maxHistoryTokens}). Final token count: ${currentTokenCount}`
            );
        }

        // Return the new history array with removed messages filtered out
        return history.filter((_, i) => !removedIndices.has(i));
    }
}
