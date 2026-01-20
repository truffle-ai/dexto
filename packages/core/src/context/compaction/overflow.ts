import type { TokenUsage } from '../../llm/types.js';

/**
 * Model limits configuration for overflow detection.
 * These limits define the context window boundaries.
 */
export interface ModelLimits {
    /** Maximum context window size in tokens (the model's input limit) */
    contextWindow: number;
}

/**
 * Determines if the context has overflowed based on token usage.
 *
 * Overflow is detected when:
 *   inputTokens > contextWindow * thresholdPercent
 *
 * The thresholdPercent allows triggering compaction before hitting 100% (e.g., at 90%).
 * This provides a safety margin for estimation errors and prevents hitting hard limits.
 *
 * Note: We don't reserve space for "output" because input and output have separate limits
 * in LLM APIs. The model's output doesn't consume from the input context window.
 *
 * @param tokens The token usage (actual from API or estimated)
 * @param modelLimits The model's context window limit
 * @param thresholdPercent Percentage of context window at which to trigger (default 0.9 = 90%)
 * @returns true if context has overflowed and compaction is needed
 */
export function isOverflow(
    tokens: TokenUsage,
    modelLimits: ModelLimits,
    thresholdPercent: number = 0.9
): boolean {
    const { contextWindow } = modelLimits;

    // Apply threshold - trigger compaction at thresholdPercent of context window
    const effectiveLimit = Math.floor(contextWindow * thresholdPercent);

    // Calculate used tokens - inputTokens is the main metric
    const inputTokens = tokens.inputTokens ?? 0;

    // Check if we've exceeded the effective limit
    return inputTokens > effectiveLimit;
}

/**
 * Calculate the compaction target - how many tokens we need to reduce to.
 *
 * @param modelLimits The model's context window limit
 * @param targetPercentage What percentage of context to target (default 70%)
 * @returns The target token count after compaction
 */
export function getCompactionTarget(
    modelLimits: ModelLimits,
    targetPercentage: number = 0.7
): number {
    const { contextWindow } = modelLimits;
    return Math.floor(contextWindow * targetPercentage);
}
