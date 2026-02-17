/**
 * useTokenCounter Hook
 * Tracks token usage during streaming with live estimates
 *
 * Accumulation strategy for multi-step turns:
 * - lastInputTokens: Input tokens from the most recent LLM call (not summed to avoid double-counting)
 * - cumulativeOutputTokens: Sum of output tokens across all LLM calls in the turn
 * - currentSegmentEstimate: Estimated tokens for current streaming segment
 * - Display = lastInput + cumulativeOutput + currentEstimate
 *
 * This approach avoids double-counting shared context (system prompt, history) across
 * multiple LLM calls in a single turn while accurately capturing output generation.
 *
 * For queued messages: Tokens continue accumulating (same turn)
 * Reset only when isActive transitions false→true (new turn)
 */

import { useState, useEffect, useRef } from 'react';
import type { DextoAgent } from '@dexto/core';

export interface TokenCounterOptions {
    /** DextoAgent instance for event bus access */
    agent: DextoAgent;
    /** Whether counting is active (should only run during processing) */
    isActive: boolean;
}

export interface TokenCounterResult {
    /** Total actual tokens (lastInput + cumulativeOutput) */
    totalActualTokens: number;
    /** Estimated tokens for current streaming segment */
    currentSegmentEstimate: number;
    /** Combined display count (actual + current estimate) */
    displayCount: number;
    /** Whether the display includes an estimate component */
    includesEstimate: boolean;
    /** Formatted display string (e.g., "~125 tokens" or "125 tokens") */
    formatted: string;
}

/**
 * Estimate tokens from character count
 * Uses ~4 characters per token as a rough approximation
 * This matches common tokenizer behavior for English text
 */
function estimateTokens(charCount: number): number {
    return Math.ceil(charCount / 4);
}

/**
 * Format token count for display
 * Only shows count when >= 1000, using x.xK format
 */
function formatTokenCount(count: number, includesEstimate: boolean): string {
    if (count < 1000) return '';
    const prefix = includesEstimate ? '~' : '';
    const kValue = (count / 1000).toFixed(1);
    return `${prefix}${kValue}K tokens`;
}

/**
 * Hook that tracks token usage during LLM streaming
 *
 * Tracks tokens across multi-step turns (text → tool → text → tool)
 * using: lastInputTokens + cumulativeOutputTokens to avoid double-counting.
 *
 * @param options - Configuration options
 * @returns Token counts (actual + current segment estimate)
 */
export function useTokenCounter({ agent, isActive }: TokenCounterOptions): TokenCounterResult {
    // Input tokens from the most recent LLM response (replaced, not summed)
    const [lastInputTokens, setLastInputTokens] = useState(0);
    // Cumulative output tokens across all LLM responses in this turn
    const [cumulativeOutputTokens, setCumulativeOutputTokens] = useState(0);
    // Estimated tokens for current streaming segment (resets after each response)
    const [currentSegmentEstimate, setCurrentSegmentEstimate] = useState(0);
    // Character count for current segment (ref to avoid re-renders on each chunk)
    const currentCharCountRef = useRef(0);

    useEffect(() => {
        if (!isActive) {
            // Reset when turn ends (isActive becomes false)
            setLastInputTokens(0);
            setCumulativeOutputTokens(0);
            setCurrentSegmentEstimate(0);
            currentCharCountRef.current = 0;
            return;
        }

        const controller = new AbortController();
        const { signal } = controller;

        // Reset on new turn (isActive just became true)
        currentCharCountRef.current = 0;
        setLastInputTokens(0);
        setCumulativeOutputTokens(0);
        setCurrentSegmentEstimate(0);

        // Track streaming chunks - accumulate estimate for current segment
        agent.on(
            'llm:chunk',
            (payload) => {
                if (payload.chunkType === 'text') {
                    currentCharCountRef.current += payload.content.length;
                    const estimate = estimateTokens(currentCharCountRef.current);
                    // Avoid frequent re-renders for short responses where we don't show tokens anyway.
                    if (estimate >= 1000) {
                        setCurrentSegmentEstimate(estimate);
                    }
                }
            },
            { signal }
        );

        // On response: update input (replace), accumulate output, reset estimate
        agent.on(
            'llm:response',
            (payload) => {
                const usage = payload.tokenUsage;
                if (usage) {
                    // Replace input tokens (most recent call's context)
                    // Subtract cacheWriteTokens to exclude system prompt on first call
                    const rawInputTokens = usage.inputTokens ?? 0;
                    const cacheWriteTokens = usage.cacheWriteTokens ?? 0;
                    const inputTokens = Math.max(0, rawInputTokens - cacheWriteTokens);
                    if (inputTokens > 0) {
                        setLastInputTokens(inputTokens);
                    }
                    // Accumulate output tokens (additive across calls)
                    const outputTokens = usage.outputTokens ?? 0;
                    if (outputTokens > 0) {
                        setCumulativeOutputTokens((prev) => prev + outputTokens);
                    }
                }
                // Reset current segment for next streaming segment
                currentCharCountRef.current = 0;
                setCurrentSegmentEstimate(0);
            },
            { signal }
        );

        // Note: No reset on llm:thinking - queued messages continue the same turn
        // Reset only happens when isActive transitions (new user-initiated turn)

        return () => {
            controller.abort();
        };
    }, [agent, isActive]);

    // Total = lastInput + cumulativeOutput (avoids double-counting shared context)
    const totalActualTokens = lastInputTokens + cumulativeOutputTokens;
    // Display = actual + current streaming estimate
    const displayCount = totalActualTokens + currentSegmentEstimate;
    const includesEstimate = currentSegmentEstimate > 0;

    return {
        totalActualTokens,
        currentSegmentEstimate,
        displayCount,
        includesEstimate,
        formatted: formatTokenCount(displayCount, includesEstimate),
    };
}
