/**
 * MiddleRemovalStrategy - Simple compression by removing middle messages.
 *
 * This strategy removes messages from the middle of the conversation history,
 * preserving the most recent messages and the initial context. It's a simple,
 * synchronous strategy suitable for use in prepareStep callbacks.
 *
 * @see /complete-context-management-plan.md
 */

import type { InternalMessage } from '../../../context/types.js';
import type { ITokenizer } from '../../tokenizer/types.js';
import type { ICompressionStrategy, CompressionTrigger } from '../types.js';
import type { IDextoLogger } from '../../../logger/v2/types.js';
import { DextoLogComponent } from '../../../logger/v2/types.js';
import { countMessagesTokens } from '../../../context/utils.js';

export interface MiddleRemovalOptions {
    /**
     * Number of messages to preserve at the beginning of history.
     * Default: 2 (typically initial user message + first assistant response)
     */
    preserveStart?: number;

    /**
     * Number of messages to preserve at the end of history.
     * Default: 10 (recent context)
     */
    preserveEnd?: number;

    /**
     * Minimum number of messages that must be removed to apply compression.
     * Prevents removing just 1-2 messages which provides little benefit.
     * Default: 3
     */
    minRemoval?: number;
}

/**
 * Compression strategy that removes messages from the middle of history.
 *
 * This is a simple, deterministic strategy that:
 * 1. Keeps the first N messages (initial context)
 * 2. Keeps the last M messages (recent context)
 * 3. Removes everything in between
 *
 * Appropriate for threshold-based compression when context is getting large
 * but we don't need sophisticated summarization.
 */
export class MiddleRemovalStrategy implements ICompressionStrategy {
    readonly name = 'middle-removal';
    readonly trigger: CompressionTrigger = { type: 'threshold', percentage: 0.8 };

    private readonly preserveStart: number;
    private readonly preserveEnd: number;
    private readonly minRemoval: number;
    private readonly logger: IDextoLogger;

    constructor(options: MiddleRemovalOptions = {}, logger: IDextoLogger) {
        this.preserveStart = options.preserveStart ?? 2;
        this.preserveEnd = options.preserveEnd ?? 10;
        this.minRemoval = options.minRemoval ?? 3;
        this.logger = logger.createChild(DextoLogComponent.CONTEXT);
    }

    /**
     * Compress history by removing middle messages.
     *
     * @param history Current message history
     * @param tokenizer Tokenizer for counting (used for logging)
     * @param maxTokens Maximum allowed tokens
     * @returns Compressed history with middle messages removed
     */
    compress(
        history: InternalMessage[],
        tokenizer: ITokenizer,
        maxTokens: number
    ): InternalMessage[] {
        // If history is too short, can't remove middle
        if (history.length <= this.preserveStart + this.preserveEnd + this.minRemoval) {
            this.logger.debug(
                `MiddleRemoval: History too short (${history.length} messages), skipping compression`
            );
            return history;
        }

        // Calculate how many messages to remove
        const middleStart = this.preserveStart;
        const middleEnd = history.length - this.preserveEnd;
        const toRemove = middleEnd - middleStart;

        if (toRemove < this.minRemoval) {
            this.logger.debug(
                `MiddleRemoval: Only ${toRemove} messages to remove, below minRemoval (${this.minRemoval})`
            );
            return history;
        }

        // Count tokens before compression
        const beforeTokens = countMessagesTokens(history, tokenizer, undefined, this.logger);

        // Build compressed history
        const startMessages = history.slice(0, this.preserveStart);
        const endMessages = history.slice(-this.preserveEnd);

        // Add a marker message indicating compression occurred
        const markerMessage: InternalMessage = {
            role: 'system',
            content: `[Earlier conversation context was compressed. ${toRemove} messages removed to fit context window.]`,
            timestamp: Date.now(),
        };

        const compressed = [...startMessages, markerMessage, ...endMessages];

        // Count tokens after compression
        const afterTokens = countMessagesTokens(compressed, tokenizer, undefined, this.logger);

        this.logger.info(
            `MiddleRemoval: Removed ${toRemove} messages (${history.length} -> ${compressed.length}), ` +
                `tokens: ${beforeTokens} -> ${afterTokens} (saved ${beforeTokens - afterTokens})`
        );

        return compressed;
    }

    /**
     * Validate that compression actually reduced token count.
     */
    validate(beforeTokens: number, afterTokens: number): boolean {
        return afterTokens < beforeTokens;
    }
}
