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
    summaryPrompt: `You are a conversation summarizer creating a structured summary for session continuation.

Analyze the conversation and produce a summary in the following XML format:

<session_compaction>
  <conversation_history>
    A concise summary of what happened in the conversation:
    - Tasks attempted and their outcomes (success/failure/in-progress)
    - Important decisions made
    - Key information discovered (file paths, configurations, errors encountered)
    - Tools used and their results
  </conversation_history>

  <current_task>
    The most recent task or instruction the user requested that may still be in progress.
    Be specific - include the exact request and current status.
  </current_task>

  <important_context>
    Critical state that must be preserved:
    - File paths being worked on
    - Variable values or configurations
    - Error messages that need addressing
    - Any pending actions or next steps
  </important_context>
</session_compaction>

IMPORTANT: The assistant will continue working based on this summary. Ensure the current_task section clearly states what needs to be done next.

Conversation to summarize:
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

        // Find the most recent user message to understand current task
        const currentTaskMessage = this.findCurrentTaskMessage(history);

        this.logger.info(
            `ReactiveOverflowStrategy: Summarizing ${toSummarize.length} messages, keeping ${toKeep.length}`
        );

        // Generate LLM summary of old messages with current task context
        const summary = await this.generateSummary(toSummarize, currentTaskMessage);

        // Create summary message (will be ADDED to history, not replace)
        // originalMessageCount tells filterCompacted() how many messages were summarized
        const summaryMessage: InternalMessage = {
            role: 'assistant',
            content: [{ type: 'text', text: summary }],
            timestamp: Date.now(),
            metadata: {
                isSummary: true,
                summarizedAt: Date.now(),
                originalMessageCount: toSummarize.length,
                originalFirstTimestamp: toSummarize[0]?.timestamp,
                originalLastTimestamp: toSummarize[toSummarize.length - 1]?.timestamp,
            },
        };

        // Return just the summary message - caller adds it to history
        // filterCompacted() will handle excluding old messages at read-time
        return [summaryMessage];
    }

    /**
     * Find the most recent user message that represents the current task.
     * This helps preserve context about what the user is currently asking for.
     */
    private findCurrentTaskMessage(history: readonly InternalMessage[]): string | null {
        // Search backwards for the most recent user message
        for (let i = history.length - 1; i >= 0; i--) {
            const msg = history[i];
            if (msg?.role === 'user') {
                if (typeof msg.content === 'string') {
                    return msg.content;
                } else if (Array.isArray(msg.content)) {
                    const textParts = msg.content
                        .filter(
                            (part): part is { type: 'text'; text: string } => part.type === 'text'
                        )
                        .map((part) => part.text)
                        .join('\n');
                    if (textParts.length > 0) {
                        return textParts;
                    }
                }
            }
        }
        return null;
    }

    /**
     * Split history into messages to summarize and messages to keep.
     * Keeps the last N turns (user + assistant pairs) intact.
     *
     * For long agentic conversations with many tool calls, this also ensures
     * we don't try to keep too many messages even within preserved turns.
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
            if (splitIndex !== undefined && splitIndex > 0) {
                return {
                    toSummarize: history.slice(0, splitIndex),
                    toKeep: history.slice(splitIndex),
                };
            }
        }

        // Fallback for agentic conversations: if splitIndex is 0 (few user messages)
        // or we can't identify turns, use a message-count-based approach.
        // Keep only the last ~20% of messages or minimum 6 messages (2-3 tool rounds)
        const minKeep = 6;
        const maxKeepPercent = 0.2;
        const keepCount = Math.max(minKeep, Math.floor(history.length * maxKeepPercent));

        // But don't summarize if we'd keep everything anyway
        if (keepCount >= history.length) {
            return {
                toSummarize: [],
                toKeep: history,
            };
        }

        this.logger.debug(
            `splitHistory: Using fallback - keeping last ${keepCount} of ${history.length} messages`
        );

        return {
            toSummarize: history.slice(0, -keepCount),
            toKeep: history.slice(-keepCount),
        };
    }

    /**
     * Generate an LLM summary of the messages.
     *
     * @param messages Messages to summarize
     * @param currentTask The most recent user message (current task context)
     */
    private async generateSummary(
        messages: readonly InternalMessage[],
        currentTask: string | null
    ): Promise<string> {
        const formattedConversation = this.formatMessagesForSummary(messages);

        // Add current task context to the prompt if available
        let conversationWithContext = formattedConversation;
        if (currentTask) {
            conversationWithContext += `\n\n--- CURRENT TASK (most recent user request) ---\n${currentTask}`;
        }

        const prompt = this.options.summaryPrompt.replace(
            '{conversation}',
            conversationWithContext
        );

        try {
            const result = await generateText({
                model: this.model,
                prompt,
                maxOutputTokens: this.options.maxSummaryTokens,
            });

            // Return structured summary - the XML format from the LLM
            return `[Session Compaction Summary]\n${result.text}`;
        } catch (error) {
            this.logger.error('ReactiveOverflowStrategy: Failed to generate summary', { error });
            // Fallback: return a simple truncated version with current task
            return this.createFallbackSummary(messages, currentTask);
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
    private createFallbackSummary(
        messages: readonly InternalMessage[],
        currentTask: string | null
    ): string {
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

        // Create XML-structured fallback
        let fallback = `[Session Compaction Summary - Fallback]
<session_compaction>
  <conversation_history>
    User discussed: ${userTopics || 'various topics'}
    Tools used: ${toolsUsed || 'none'}
    Messages summarized: ${messages.length}
  </conversation_history>`;

        if (currentTask) {
            fallback += `
  <current_task>
    ${currentTask.slice(0, 500)}${currentTask.length > 500 ? '...' : ''}
  </current_task>`;
        }

        fallback += `
  <important_context>
    Note: This is a fallback summary due to LLM error. Context may be incomplete.
  </important_context>
</session_compaction>`;

        return fallback;
    }
}
