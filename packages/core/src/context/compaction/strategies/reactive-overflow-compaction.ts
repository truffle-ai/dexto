import { generateText, type LanguageModel } from 'ai';
import type { InternalMessage, ToolCall } from '../../types.js';
import { isAssistantMessage, isToolMessage } from '../../types.js';
import type { Logger } from '../../../logger/v2/types.js';
import { isOverflow, type ModelLimits } from '../overflow.js';
import type {
    CompactionResult,
    CompactionRuntimeContext,
    CompactionSettings,
    CompactionStrategy,
    CompactionWindow,
} from '../types.js';

/**
 * Configuration options for ReactiveOverflowCompactionStrategy.
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

export interface ReactiveOverflowCompactionStrategyOptions {
    enabled?: boolean | undefined;
    maxContextTokens?: number | undefined;
    thresholdPercent?: number | undefined;
    strategy?: ReactiveOverflowOptions | undefined;
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
 * ReactiveOverflowCompactionStrategy implements reactive compaction.
 *
 * Key behaviors:
 * - Triggers on overflow (after actual tokens exceed context limit)
 * - Uses LLM to generate intelligent summary of older messages
 * - Returns a structured summary + working-history boundary
 * - Core materializes that boundary into the session's continuation window
 *
 * This strategy is designed to work with TurnExecutor's main loop:
 * 1. After each step, check if overflow occurred
 * 2. If yes, generate a replacement summary over the oldest working-memory prefix
 * 3. Core materializes the preserved working-memory tail for the next continuation
 * 4. Continue with fresh context (summary + recent messages)
 */
export class ReactiveOverflowCompactionStrategy implements CompactionStrategy {
    readonly name = 'reactive-overflow';

    private readonly settings: CompactionSettings;
    private readonly strategyOptions: Required<ReactiveOverflowOptions>;

    constructor(options: ReactiveOverflowCompactionStrategyOptions = {}) {
        this.settings = {
            enabled: options.enabled ?? true,
            maxContextTokens: options.maxContextTokens,
            thresholdPercent: options.thresholdPercent ?? 0.9,
        };
        this.strategyOptions = {
            ...DEFAULT_OPTIONS,
            ...(options.strategy ?? {}),
        };
    }

    getSettings(): CompactionSettings {
        return this.settings;
    }

    getModelLimits(modelContextWindow: number): ModelLimits {
        const capped =
            this.settings.enabled && this.settings.maxContextTokens !== undefined
                ? Math.min(modelContextWindow, this.settings.maxContextTokens)
                : modelContextWindow;

        return { contextWindow: capped };
    }

    shouldCompact(inputTokens: number, modelLimits: ModelLimits): boolean {
        if (!this.settings.enabled) {
            return false;
        }
        return isOverflow({ inputTokens }, modelLimits, this.settings.thresholdPercent);
    }

    async compact(
        window: CompactionWindow,
        context: CompactionRuntimeContext
    ): Promise<CompactionResult | null> {
        if (!this.settings.enabled) {
            return null;
        }

        const { model, logger } = context;
        const workingHistory = window.workingHistory;
        const freshHistory = window.freshHistory;

        // Don't compact if history is too short
        if (workingHistory.length <= 2) {
            logger.debug(
                'ReactiveOverflowCompactionStrategy: History too short, skipping compaction'
            );
            return null;
        }

        if (window.latestSummary && freshHistory.length <= 4) {
            logger.debug(
                `ReactiveOverflowCompactionStrategy: Only ${freshHistory.length} fresh message(s) after latest summary, skipping re-compaction`
            );
            return null;
        }

        // Split working history into messages to summarize and messages to keep
        const { toSummarize, toKeep } = this.splitHistory(workingHistory);

        // If nothing to summarize, return empty (no summary needed)
        if (toSummarize.length === 0) {
            logger.debug('ReactiveOverflowCompactionStrategy: No messages to summarize');
            return null;
        }

        // Find the most recent user message to understand current task
        const currentTaskMessage = this.findCurrentTaskMessage(window.activeHistory);

        const summaryInput = window.latestSummary
            ? [window.latestSummary.message, ...toSummarize]
            : [...toSummarize];

        logger.info(
            `ReactiveOverflowCompactionStrategy: Summarizing ${summaryInput.length} message(s) of context, keeping ${toKeep.length} working message(s)`
        );

        // Generate LLM summary of old messages with current task context.
        // When a prior summary exists, it becomes part of the new summary input so
        // the resulting replacement summary fully supersedes it.
        const summary = await this.generateSummary(summaryInput, currentTaskMessage, model, logger);

        const summaryMessage: InternalMessage = {
            role: 'assistant',
            content: [{ type: 'text', text: summary }],
            timestamp: Date.now(),
            metadata: {
                isSummary: true,
                summarizedAt: Date.now(),
                ...(window.latestSummary ? { isRecompaction: true } : {}),
                originalFirstTimestamp: summaryInput[0]?.timestamp,
                originalLastTimestamp: summaryInput[summaryInput.length - 1]?.timestamp,
            },
        };

        return {
            summaryMessages: [summaryMessage],
            preserveFromWorkingIndex: toSummarize.length,
        };
    }

    /**
     * Find the most recent user message that represents the current task.
     */
    private findCurrentTaskMessage(history: readonly InternalMessage[]): string | null {
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
     */
    private splitHistory(history: readonly InternalMessage[]): {
        toSummarize: readonly InternalMessage[];
        toKeep: readonly InternalMessage[];
    } {
        const turnsToKeep = this.strategyOptions.preserveLastNTurns;

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

        // Fallback for agentic conversations
        const minKeep = 3;
        const maxKeepPercent = 0.2;
        const keepCount = Math.max(minKeep, Math.floor(history.length * maxKeepPercent));

        if (keepCount >= history.length) {
            return {
                toSummarize: [],
                toKeep: history,
            };
        }

        return {
            toSummarize: history.slice(0, -keepCount),
            toKeep: history.slice(-keepCount),
        };
    }

    /**
     * Generate an LLM summary of the messages.
     */
    private async generateSummary(
        messages: readonly InternalMessage[],
        currentTask: string | null,
        model: LanguageModel,
        logger: Logger
    ): Promise<string> {
        const formattedConversation = this.formatMessagesForSummary(messages);

        let conversationWithContext = formattedConversation;
        if (currentTask) {
            conversationWithContext += `\n\n--- CURRENT TASK (most recent user request) ---\n${currentTask}`;
        }

        const prompt = this.strategyOptions.summaryPrompt.replace(
            '{conversation}',
            conversationWithContext
        );

        try {
            const result = await generateText({
                model,
                prompt,
                maxOutputTokens: this.strategyOptions.maxSummaryTokens,
            });

            return `[Session Compaction Summary]\n${result.text}`;
        } catch (error) {
            logger.error(
                `ReactiveOverflowCompactionStrategy: Failed to generate summary - ${error instanceof Error ? error.message : String(error)}`
            );
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
                    content = msg.content
                        .filter(
                            (part): part is { type: 'text'; text: string } => part.type === 'text'
                        )
                        .map((part) => part.text)
                        .join('\n');
                } else {
                    content = '[no content]';
                }

                if (content.length > 2000) {
                    content = content.slice(0, 2000) + '... [truncated]';
                }

                if (isAssistantMessage(msg) && msg.toolCalls && msg.toolCalls.length > 0) {
                    const toolNames = msg.toolCalls
                        .map((tc: ToolCall) => tc.function.name)
                        .join(', ');
                    content += `\n[Used tools: ${toolNames}]`;
                }

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
