/**
 * ReactiveOverflowStrategy - LLM-based compression for context overflow.
 *
 * When context exceeds the token limit, this strategy uses an LLM to generate
 * a summary of older messages. The summary replaces the old messages, preserving
 * the essential context while freeing up space.
 *
 * This is an async strategy that cannot be used in synchronous contexts like
 * Vercel's prepareStep callback.
 *
 * @see /complete-context-management-plan.md
 */

import type { InternalMessage } from '../../../context/types.js';
import type { ITokenizer } from '../../tokenizer/types.js';
import type { ICompressionStrategy, CompressionTrigger } from '../types.js';
import type { IDextoLogger } from '../../../logger/v2/types.js';
import { DextoLogComponent } from '../../../logger/v2/types.js';

/**
 * Options for ReactiveOverflowStrategy.
 */
export interface ReactiveOverflowOptions {
    /**
     * Number of recent turns to always preserve (not summarized).
     * A "turn" is a user message + assistant response pair.
     * Default: 2
     */
    preserveLastNTurns?: number;

    /**
     * Maximum tokens for the generated summary.
     * Default: 2000
     */
    summaryMaxTokens?: number;

    /**
     * Token threshold for protecting recent content from summarization.
     * Messages within this threshold are never summarized.
     * Default: 40000
     */
    pruneProtectTokens?: number;
}

/**
 * Function type for generating summaries via LLM.
 */
export type SummaryGenerator = (messages: InternalMessage[], maxTokens: number) => Promise<string>;

/**
 * Compression strategy that uses an LLM to summarize old messages.
 *
 * How it works:
 * 1. Identify messages that can be summarized (not recent, not protected)
 * 2. Generate an LLM summary of those messages
 * 3. Replace old messages with the summary message
 * 4. Keep recent messages intact
 *
 * This strategy:
 * - Preserves recent context (last N turns)
 * - Creates a meaningful summary of earlier conversation
 * - Is async (requires LLM call)
 */
export class ReactiveOverflowStrategy implements ICompressionStrategy {
    readonly name = 'reactive-overflow';
    readonly trigger: CompressionTrigger = { type: 'overflow' };

    private readonly preserveLastNTurns: number;
    private readonly summaryMaxTokens: number;
    private readonly pruneProtectTokens: number;
    private readonly generateSummary: SummaryGenerator;
    private readonly logger: IDextoLogger;

    constructor(
        generateSummary: SummaryGenerator,
        options: ReactiveOverflowOptions = {},
        logger: IDextoLogger
    ) {
        this.generateSummary = generateSummary;
        this.preserveLastNTurns = options.preserveLastNTurns ?? 2;
        this.summaryMaxTokens = options.summaryMaxTokens ?? 2000;
        this.pruneProtectTokens = options.pruneProtectTokens ?? 40000;
        this.logger = logger.createChild(DextoLogComponent.CONTEXT);
    }

    /**
     * Compress history by summarizing old messages.
     *
     * @param history Current message history
     * @param tokenizer Tokenizer for counting tokens
     * @param maxTokens Maximum allowed tokens
     * @returns Compressed history with summary replacing old messages
     */
    async compress(
        history: InternalMessage[],
        tokenizer: ITokenizer,
        maxTokens: number
    ): Promise<InternalMessage[]> {
        // Find the split point between "old" and "recent" messages
        const splitIndex = this.findSplitIndex(history, tokenizer);

        if (splitIndex <= 0) {
            this.logger.debug(
                'ReactiveOverflow: No messages to summarize (all within protected zone)'
            );
            return history;
        }

        // Split history
        const oldMessages = history.slice(0, splitIndex);
        const recentMessages = history.slice(splitIndex);

        this.logger.info(
            `ReactiveOverflow: Summarizing ${oldMessages.length} messages, keeping ${recentMessages.length}`
        );

        // Generate summary
        const summary = await this.generateSummary(oldMessages, this.summaryMaxTokens);

        // Create summary message
        const summaryMessage: InternalMessage = {
            role: 'assistant',
            content: `**Conversation Summary**\n\n${summary}`,
            timestamp: Date.now(),
        };

        // Return new history: summary + recent messages
        return [summaryMessage, ...recentMessages];
    }

    /**
     * Validate that compression reduced token count.
     */
    validate(beforeTokens: number, afterTokens: number): boolean {
        const reduced = afterTokens < beforeTokens;
        if (!reduced) {
            this.logger.warn(
                `ReactiveOverflow: Summary did not reduce tokens (${beforeTokens} -> ${afterTokens})`
            );
        }
        return reduced;
    }

    /**
     * Find the index where we should split old vs recent messages.
     *
     * We count backwards from the end, preserving:
     * 1. At least N turns (user + assistant pairs)
     * 2. Messages within the protect threshold
     */
    private findSplitIndex(history: InternalMessage[], tokenizer: ITokenizer): number {
        if (history.length === 0) return 0;

        let protectedTokens = 0;
        let turnCount = 0;
        let lastRole: string | null = null;

        // Count backwards to find split point
        for (let i = history.length - 1; i >= 0; i--) {
            const msg = history[i];
            if (!msg) continue;

            // Count tokens for this message
            const content = typeof msg.content === 'string' ? msg.content : '';
            const tokens = tokenizer.countTokens(content);
            protectedTokens += tokens;

            // Count turns (user -> assistant or assistant -> user transition)
            if (msg.role === 'user' && lastRole !== 'user') {
                turnCount++;
            }
            lastRole = msg.role;

            // Check if we've protected enough
            const enoughTurns = turnCount >= this.preserveLastNTurns;
            const enoughTokens = protectedTokens >= this.pruneProtectTokens;

            if (enoughTurns || enoughTokens) {
                // Return the index where "old" messages end
                return i;
            }
        }

        // If we get here, we couldn't find a good split point
        // (entire history is "recent")
        return 0;
    }
}

/**
 * Create a default summary prompt for the LLM.
 */
export function createSummaryPrompt(messages: InternalMessage[]): string {
    const formattedMessages = messages
        .map((msg) => {
            const role =
                msg.role === 'assistant' ? 'Assistant' : msg.role === 'user' ? 'User' : msg.role;
            const content = typeof msg.content === 'string' ? msg.content : '[complex content]';
            return `${role}: ${content.slice(0, 500)}${content.length > 500 ? '...' : ''}`;
        })
        .join('\n\n');

    return `Summarize this conversation, focusing on:
- What was accomplished
- Current state and context
- What needs to happen next
- Any important decisions or findings

Keep the summary concise but capture essential context that would be needed to continue the conversation effectively.

Conversation:
${formattedMessages}`;
}
