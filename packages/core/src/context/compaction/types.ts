import type { LanguageModel } from 'ai';
import type { Logger } from '../../logger/v2/types.js';
import type { InternalMessage } from '../types.js';
import type { ModelLimits } from './overflow.js';

export interface CompactionSettings {
    enabled: boolean;
    /**
     * Optional cap on the model context window used for compaction decisions.
     * When set, compaction will behave as if the model's context window is:
     * `min(modelContextWindow, maxContextTokens)`.
     */
    maxContextTokens?: number | undefined;
    /**
     * Percentage (0.1–1.0) of the effective context window at which compaction triggers.
     * Example: 0.9 triggers at 90% of context usage.
     */
    thresholdPercent: number;
}

export interface CompactionRuntimeContext {
    sessionId: string;
    model: LanguageModel;
    logger: Logger;
}

/**
 * Compaction strategy.
 *
 * This is the DI surface used by core runtime (TurnExecutor/VercelLLMService) to:
 * - decide when to compact (budget + overflow logic)
 * - execute compaction given per-session runtime context (model, logger, sessionId)
 *
 * Strategies are created by host layers (CLI/server/apps) via image factories.
 * Core does not parse YAML, validate Zod schemas, or switch on `type` strings.
 */
export type CompactionStrategy = {
    /** Human-readable name for logging/UI */
    readonly name: string;

    /** Effective budgeting settings for this strategy */
    getSettings(): CompactionSettings;

    /** Effective model limits after applying any strategy caps */
    getModelLimits(modelContextWindow: number): ModelLimits;

    /** Whether compaction should run given current input token usage */
    shouldCompact(inputTokens: number, modelLimits: ModelLimits): boolean;

    /**
     * Compacts the provided message history.
     *
     * The returned summary messages MUST include specific metadata fields for
     * `filterCompacted()` to correctly exclude pre-summary messages at read-time:
     *
     * Required metadata:
     * - `isSummary: true` - Marks the message as a compaction summary
     * - `originalMessageCount: number` - Count of messages that were summarized
     *   (used by filterCompacted to determine which messages to exclude)
     *
     * Optional metadata:
     * - `isRecompaction: true` - Set when re-compacting after a previous summary
     * - `isSessionSummary: true` - Alternative to isSummary for session-level summaries
     *
     * @param history The current conversation history.
     * @param context Per-session runtime context (model/logger/sessionId)
     * @returns Summary messages to add to history. Empty array if nothing to compact.
     */
    compact(
        history: readonly InternalMessage[],
        context: CompactionRuntimeContext
    ): Promise<InternalMessage[]>;
};
