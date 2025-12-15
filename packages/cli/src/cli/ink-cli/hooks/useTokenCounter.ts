/**
 * useTokenCounter Hook
 * Tracks token usage during streaming with live estimates and actual counts
 *
 * Accumulation strategy for multi-step turns:
 * - totalActualTokens: Accumulated from all llm:response events in the turn
 * - currentSegmentEstimate: Estimated tokens for current streaming segment
 * - Display = totalActual + currentEstimate (shows running total + live estimate)
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
    /** Total accumulated actual tokens from all responses in this turn */
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
 */
function formatTokenCount(count: number, includesEstimate: boolean): string {
    if (count === 0) return '';
    const prefix = includesEstimate ? '~' : '';
    return `${prefix}${count} tokens`;
}

/**
 * Hook that tracks token usage during LLM streaming
 *
 * Accumulates tokens across multi-step turns (text → tool → text → tool)
 * and queued messages (which continue the same turn).
 *
 * @param options - Configuration options
 * @returns Token counts (accumulated actual + current segment estimate)
 */
export function useTokenCounter({ agent, isActive }: TokenCounterOptions): TokenCounterResult {
    // Accumulated actual tokens from all llm:response events in this turn
    const [totalActualTokens, setTotalActualTokens] = useState(0);
    // Estimated tokens for current streaming segment (resets after each response)
    const [currentSegmentEstimate, setCurrentSegmentEstimate] = useState(0);
    // Character count for current segment (ref to avoid re-renders on each chunk)
    const currentCharCountRef = useRef(0);

    useEffect(() => {
        if (!isActive) {
            // Reset when turn ends (isActive becomes false)
            setTotalActualTokens(0);
            setCurrentSegmentEstimate(0);
            currentCharCountRef.current = 0;
            return;
        }

        const bus = agent.agentEventBus;
        const controller = new AbortController();
        const { signal } = controller;

        // Reset on new turn (isActive just became true)
        // This handles the transition from inactive to active
        currentCharCountRef.current = 0;
        setTotalActualTokens(0);
        setCurrentSegmentEstimate(0);

        // Track streaming chunks - accumulate estimate for current segment
        bus.on(
            'llm:chunk',
            (payload) => {
                if (payload.chunkType === 'text') {
                    currentCharCountRef.current += payload.content.length;
                    setCurrentSegmentEstimate(estimateTokens(currentCharCountRef.current));
                }
            },
            { signal }
        );

        // On response: add actual to total, reset current segment estimate
        bus.on(
            'llm:response',
            (payload) => {
                if (payload.tokenUsage?.outputTokens !== undefined) {
                    // Accumulate actual tokens from this response
                    setTotalActualTokens((prev) => prev + payload.tokenUsage!.outputTokens!);
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

    // Display = accumulated actual + current segment estimate
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
