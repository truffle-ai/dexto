import type { TokenUsage } from '../../llm/types.js';

/**
 * Model limits configuration for overflow detection.
 * These limits define the context window boundaries.
 */
export interface ModelLimits {
    /** Maximum context window size in tokens */
    contextWindow: number;
    /** Maximum output tokens the model can generate */
    maxOutput: number;
}

/**
 * Default maximum output tokens to reserve as a buffer.
 * This ensures we have space for the model's response.
 */
const DEFAULT_OUTPUT_BUFFER = 16_000;

/**
 * Determines if the context has overflowed based on actual token usage from the API.
 *
 * Overflow is detected when:
 * used tokens > (contextWindow - outputBuffer) * thresholdPercent
 *
 * The outputBuffer ensures we always have room for the model's response.
 * The thresholdPercent allows triggering compaction before hitting 100% (e.g., at 90%).
 *
 * @param tokens The actual token usage from the last LLM API call
 * @param modelLimits The model's context window and output limits
 * @param thresholdPercent Percentage of usable tokens at which to trigger (default 1.0 = 100%)
 * @returns true if context has overflowed and compaction is needed
 */
export function isOverflow(
    tokens: TokenUsage,
    modelLimits: ModelLimits,
    thresholdPercent: number = 1.0
): boolean {
    const { contextWindow, maxOutput } = modelLimits;

    // Reserve space for model output
    const outputBuffer = Math.min(maxOutput, DEFAULT_OUTPUT_BUFFER);
    const usableTokens = contextWindow - outputBuffer;

    // Apply threshold - trigger compaction at thresholdPercent of usable tokens
    const effectiveLimit = Math.floor(usableTokens * thresholdPercent);

    // Calculate used tokens - inputTokens is the main metric from API response
    const inputTokens = tokens.inputTokens ?? 0;

    // Check if we've exceeded the effective limit
    return inputTokens > effectiveLimit;
}

/**
 * Calculate the compaction target - how many tokens we need to reduce to.
 *
 * @param modelLimits The model's context window and output limits
 * @param targetPercentage What percentage of usable context to target (default 70%)
 * @returns The target token count after compaction
 */
export function getCompactionTarget(
    modelLimits: ModelLimits,
    targetPercentage: number = 0.7
): number {
    const { contextWindow, maxOutput } = modelLimits;
    const outputBuffer = Math.min(maxOutput, DEFAULT_OUTPUT_BUFFER);
    const usableTokens = contextWindow - outputBuffer;

    return Math.floor(usableTokens * targetPercentage);
}
