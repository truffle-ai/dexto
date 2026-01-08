import { generateText, type LanguageModel } from 'ai';
import type { ICompactionStrategy } from '../types.js';
import type { InternalMessage, ToolCall } from '../../types.js';
import { isAssistantMessage, isToolMessage } from '../../types.js';
import type { IDextoLogger } from '../../../logger/v2/types.js';

/**
 * Configuration options for ReactiveOverflowStrategy.
 */
export interface ReactiveOverflowOptions {
    /**
     * Number of recent turns to preserve (not summarize).
     * A "turn" is a user message + assistant response pair.
     * Default: 2
     */
    preserveLastNTurns?: number;

    /**
     * Maximum tokens for the summary output.
     * Default: 2000
     */
    maxSummaryTokens?: number;

    /**
     * Custom summary prompt template.
     * Use {conversation} as placeholder for formatted messages.
     */
    summaryPrompt?: string;
}

const DEFAULT_OPTIONS: Required<ReactiveOverflowOptions> = {
    preserveLastNTurns: 2,
    maxSummaryTokens: 2000,
    summaryPrompt: `You are a conversation summarizer. Summarize the following conversation history concisely, focusing on:
- What tasks were attempted and their outcomes
- Current state and context the assistant needs to remember
- Any important decisions or information discovered
- What the user was trying to accomplish

Be concise but preserve essential context. Output only the summary, no preamble.

Conversation:
{conversation}`,
};

/**
 * ReactiveOverflowStrategy implements reactive compaction.
 *
 * Key behaviors:
 * - Triggers on overflow (after actual tokens exceed context limit)
 * - Uses LLM to generate intelligent summary of older messages
 * - Returns summary message to ADD to history (not replace)
 * - Read-time filtering via filterCompacted() excludes pre-summary messages
 *
 * This strategy is designed to work with TurnExecutor's main loop:
 * 1. After each step, check if overflow occurred
 * 2. If yes, generate summary and ADD it to history
 * 3. filterCompacted() in getFormattedMessages() excludes old messages
 * 4. Continue with fresh context (summary + recent messages)
 *
 * NOTE: This does NOT replace history. The summary message is ADDED,
 * and filterCompacted() handles excluding old messages at read-time.
 * This preserves full history for audit/recovery purposes.
 */
export class ReactiveOverflowStrategy implements ICompactionStrategy {
    readonly name = 'reactive-overflow';

    private readonly model: LanguageModel;
    private readonly options: Required<ReactiveOverflowOptions>;
    private readonly logger: IDextoLogger;

    constructor(model: LanguageModel, options: ReactiveOverflowOptions = {}, logger: IDextoLogger) {
        this.model = model;
        this.options = { ...DEFAULT_OPTIONS, ...options };
        this.logger = logger;
    }

    /**
     * Generate a summary message for the old portion of history.
     *
     * IMPORTANT: This does NOT replace history. It returns a summary message
     * that the caller should ADD to history via contextManager.addMessage().
     * Read-time filtering (filterCompacted) will then exclude pre-summary
     * messages when formatting for LLM.
     *
     * @param history The full conversation history
     * @returns Array with single summary message to add, or empty if nothing to summarize
     */
    async compact(history: readonly InternalMessage[]): Promise<InternalMessage[]> {
        // Don't compact if history is too short
        if (history.length <= 2) {
            this.logger.debug('ReactiveOverflowStrategy: History too short, skipping compaction');
            return [];
        }

        // Split history into messages to summarize and messages to keep
        const { toSummarize, toKeep } = this.splitHistory(history);

        // If nothing to summarize, return empty (no summary needed)
        if (toSummarize.length === 0) {
            this.logger.debug('ReactiveOverflowStrategy: No messages to summarize');
            return [];
        }

        this.logger.info(
            `ReactiveOverflowStrategy: Summarizing ${toSummarize.length} messages, keeping ${toKeep.length}`
        );

        // Generate LLM summary of old messages
        const summary = await this.generateSummary(toSummarize);

        // Create summary message (will be ADDED to history, not replace)
        const summaryMessage: InternalMessage = {
            role: 'assistant',
            content: [{ type: 'text', text: summary }],
            timestamp: Date.now(),
            metadata: {
                isSummary: true,
                summarizedAt: Date.now(),
                summarizedMessageCount: toSummarize.length,
                originalFirstTimestamp: toSummarize[0]?.timestamp,
                originalLastTimestamp: toSummarize[toSummarize.length - 1]?.timestamp,
            },
        };

        // Return just the summary message - caller adds it to history
        // filterCompacted() will handle excluding old messages at read-time
        return [summaryMessage];
    }

    /**
     * Split history into messages to summarize and messages to keep.
     * Keeps the last N turns (user + assistant pairs) intact.
     */
    private splitHistory(history: readonly InternalMessage[]): {
        toSummarize: readonly InternalMessage[];
        toKeep: readonly InternalMessage[];
    } {
        const turnsToKeep = this.options.preserveLastNTurns;

        // Find indices of the last N user messages (start of each turn)
        const userMessageIndices: number[] = [];
        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i]?.role === 'user') {
                userMessageIndices.unshift(i);
                if (userMessageIndices.length >= turnsToKeep) {
                    break;
                }
            }
        }

        // If we found turn boundaries, split at the first one
        if (userMessageIndices.length > 0) {
            const splitIndex = userMessageIndices[0];
            if (splitIndex !== undefined) {
                // splitIndex === 0 means all messages are in turns to keep, nothing to summarize
                if (splitIndex === 0) {
                    return {
                        toSummarize: [],
                        toKeep: history,
                    };
                }
                return {
                    toSummarize: history.slice(0, splitIndex),
                    toKeep: history.slice(splitIndex),
                };
            }
        }

        // Fallback: if we can't identify turns properly, keep last few messages
        const keepCount = Math.min(4, history.length);
        return {
            toSummarize: history.slice(0, -keepCount),
            toKeep: history.slice(-keepCount),
        };
    }

    /**
     * Generate an LLM summary of the messages.
     */
    private async generateSummary(messages: readonly InternalMessage[]): Promise<string> {
        const formattedConversation = this.formatMessagesForSummary(messages);
        const prompt = this.options.summaryPrompt.replace('{conversation}', formattedConversation);

        try {
            const result = await generateText({
                model: this.model,
                prompt,
                maxOutputTokens: this.options.maxSummaryTokens,
            });

            return `[Previous conversation summary]\n${result.text}`;
        } catch (error) {
            this.logger.error('ReactiveOverflowStrategy: Failed to generate summary', { error });
            // Fallback: return a simple truncated version
            return this.createFallbackSummary(messages);
        }
    }

    /**
     * Format messages for the summary prompt.
     */
    private formatMessagesForSummary(messages: readonly InternalMessage[]): string {
        return messages
            .map((msg) => {
                const role = msg.role.toUpperCase();
                let content: string;

                if (typeof msg.content === 'string') {
                    content = msg.content;
                } else if (Array.isArray(msg.content)) {
                    // Extract text from content parts
                    content = msg.content
                        .filter(
                            (part): part is { type: 'text'; text: string } => part.type === 'text'
                        )
                        .map((part) => part.text)
                        .join('\n');
                } else {
                    content = '[no content]';
                }

                // Truncate very long messages
                if (content.length > 2000) {
                    content = content.slice(0, 2000) + '... [truncated]';
                }

                // Handle tool calls
                if (isAssistantMessage(msg) && msg.toolCalls && msg.toolCalls.length > 0) {
                    const toolNames = msg.toolCalls
                        .map((tc: ToolCall) => tc.function.name)
                        .join(', ');
                    content += `\n[Used tools: ${toolNames}]`;
                }

                // Handle tool results
                if (isToolMessage(msg)) {
                    return `TOOL (${msg.name}): ${content.slice(0, 500)}${content.length > 500 ? '...' : ''}`;
                }

                return `${role}: ${content}`;
            })
            .join('\n\n');
    }

    /**
     * Create a fallback summary if LLM call fails.
     */
    private createFallbackSummary(messages: readonly InternalMessage[]): string {
        const userMessages = messages.filter((m) => m.role === 'user');
        const assistantWithTools = messages.filter(
            (m): m is InternalMessage & { role: 'assistant'; toolCalls: ToolCall[] } =>
                isAssistantMessage(m) && !!m.toolCalls && m.toolCalls.length > 0
        );

        const userTopics = userMessages
            .slice(-3)
            .map((m) => {
                const text =
                    typeof m.content === 'string'
                        ? m.content
                        : Array.isArray(m.content)
                          ? m.content
                                .filter(
                                    (p): p is { type: 'text'; text: string } => p.type === 'text'
                                )
                                .map((p) => p.text)
                                .join(' ')
                          : '';
                return text.slice(0, 100);
            })
            .join('; ');

        const toolsUsed = [
            ...new Set(
                assistantWithTools.flatMap((m) => m.toolCalls.map((tc) => tc.function.name))
            ),
        ].join(', ');

        return `[Previous conversation summary - fallback]\nUser discussed: ${userTopics || 'various topics'}\nTools used: ${toolsUsed || 'none'}`;
    }
}
