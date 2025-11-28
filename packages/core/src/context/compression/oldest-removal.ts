import { ITokenizer } from '@core/llm/tokenizer/types.js';
import { InternalMessage } from '../types.js';
import { ICompressionStrategy } from './types.js';
import { countMessagesTokens } from '../utils.js';
import { ContextError } from '../errors.js';
import { IDextoLogger } from '../../logger/v2/types.js';
import { DextoLogComponent } from '../../logger/v2/types.js';

/**
 * Configuration options for the OldestRemovalStrategy.
 */
export interface OldestRemovalStrategyOptions {
    /**
     * The minimum number of messages to preserve at the end of the history.
     * The strategy will not remove messages if doing so would reduce the
     * history length below this number.
     * @default 4
     */
    minMessagesToKeep?: number;
}

/**
 * Implements a compression strategy that removes the oldest messages (from the
 * beginning of the history array) until the token count is within the limit.
 * Ensures a minimum number of recent messages are always preserved.
 */
export class OldestRemovalStrategy implements ICompressionStrategy {
    private readonly minMessagesToKeep: number;
    private readonly logger: IDextoLogger;
    /**
     * Creates an instance of OldestRemovalStrategy.
     *
     * @param options Configuration options for preserving messages.
     */
    constructor(options: OldestRemovalStrategyOptions = {}, logger: IDextoLogger) {
        this.minMessagesToKeep = options.minMessagesToKeep ?? 4;
        this.logger = logger.createChild(DextoLogComponent.CONTEXT);
        if (this.minMessagesToKeep < 0) {
            throw ContextError.minMessagesNegative();
        }
    }

    /**
     * Compresses the history by removing the oldest messages if the total
     * token count exceeds the specified maximum, while respecting minMessagesToKeep.
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
        let currentHistory = [...history]; // Work on a copy
        let currentTokenCount = countMessagesTokens(
            currentHistory,
            tokenizer,
            undefined,
            this.logger
        );

        while (
            currentHistory.length > this.minMessagesToKeep &&
            currentTokenCount > maxHistoryTokens
        ) {
            // Remove the oldest message (index 0)
            currentHistory.shift();
            // Recalculate token count after removal
            currentTokenCount = countMessagesTokens(
                currentHistory,
                tokenizer,
                undefined,
                this.logger
            );
        }

        if (
            currentTokenCount > maxHistoryTokens &&
            currentHistory.length <= this.minMessagesToKeep
        ) {
            this.logger.warn(
                `OldestRemovalStrategy: Could not compress below max tokens (${maxHistoryTokens}) without violating minMessagesToKeep (${this.minMessagesToKeep}). Final token count: ${currentTokenCount}, Messages: ${currentHistory.length}`
            );
        } else if (currentTokenCount > maxHistoryTokens) {
            this.logger.warn(
                `OldestRemovalStrategy: Unable to compress below max tokens (${maxHistoryTokens}). Final token count: ${currentTokenCount}`
            );
        }

        return currentHistory;
    }
}
