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

export interface CompactionSummaryBoundary {
    message: InternalMessage;
    storedIndex: number;
}

export interface CompactionWindow {
    /**
     * Full stored session transcript as persisted today.
     * This may still contain older summary markers for audit/tracing purposes.
     */
    storedHistory: readonly InternalMessage[];
    /**
     * Logical history currently visible to the model.
     * When a prior summary exists, this is `[latestSummary, ...workingHistory]`.
     */
    activeHistory: readonly InternalMessage[];
    /**
     * Working-memory messages carried forward from the latest summary boundary.
     * These were preserved during the previous compaction run and are still
     * visible in the current continuation window.
     */
    preservedHistory: readonly InternalMessage[];
    /**
     * Newly accumulated messages after the latest summary boundary.
     * For an uncompacted session, this is the full stored history.
     */
    freshHistory: readonly InternalMessage[];
    /**
     * Chronological working-memory messages that remain unsummarized.
     * This intentionally excludes the latest summary marker so strategies can
     * compact the logical working set without reasoning about stored transcript
     * offsets or prior summary placement.
     */
    workingHistory: readonly InternalMessage[];
    /**
     * Latest visible summary marker, if one exists.
     * Strategies can use this as already-compacted context when producing a
     * replacement summary for the next working-memory window.
     */
    latestSummary?: CompactionSummaryBoundary;
}

export interface CompactionResult {
    /**
     * Summary/carry-forward messages produced by the strategy.
     * Session-level compaction currently requires exactly one summary message.
     */
    summaryMessages: InternalMessage[];
    /**
     * Index into `workingHistory` where preserved working-memory messages begin.
     * Messages before this index are compacted into `summaryMessages`; messages
     * from this index onward stay in the continuation window unchanged.
     */
    preserveFromWorkingIndex: number;
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
     * Compacts the provided working-memory window.
     *
     * Strategies operate on an explicit logical window instead of inferring
     * boundaries from raw stored transcript indexes. Core later materializes the
     * returned boundary into whatever persistence/filtering metadata is needed.
     *
     * @param window The current compaction window for this session.
     * @param context Per-session runtime context (model/logger/sessionId)
     * @returns Structured compaction result, or null when nothing should be compacted.
     */
    compact(
        window: CompactionWindow,
        context: CompactionRuntimeContext
    ): Promise<CompactionResult | null>;
};
