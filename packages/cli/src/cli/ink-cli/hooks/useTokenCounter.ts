/**
 * useTokenCounter Hook
 * Tracks token usage during streaming with live estimates and actual counts
 *
 * During streaming: Estimates tokens from character count (chars / 4)
 * After response: Shows actual token counts from provider
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
    /** Estimated output tokens (from streaming content) */
    estimatedOutputTokens: number;
    /** Actual output tokens (from llm:response, when available) */
    actualOutputTokens: number | null;
    /** Whether we have actual counts (vs estimates) */
    hasActualCounts: boolean;
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
function formatTokenCount(count: number, isEstimate: boolean): string {
    if (count === 0) return '';
    const prefix = isEstimate ? '~' : '';
    return `${prefix}${count} tokens`;
}

/**
 * Hook that tracks token usage during LLM streaming
 *
 * @param options - Configuration options
 * @returns Token counts (estimated during streaming, actual after response)
 */
export function useTokenCounter({ agent, isActive }: TokenCounterOptions): TokenCounterResult {
    const [estimatedOutputTokens, setEstimatedOutputTokens] = useState(0);
    const [actualOutputTokens, setActualOutputTokens] = useState<number | null>(null);
    const charCountRef = useRef(0);

    useEffect(() => {
        if (!isActive) {
            // Reset when not active
            setEstimatedOutputTokens(0);
            setActualOutputTokens(null);
            charCountRef.current = 0;
            return;
        }

        const bus = agent.agentEventBus;
        const controller = new AbortController();
        const { signal } = controller;

        // Reset on new run
        charCountRef.current = 0;
        setEstimatedOutputTokens(0);
        setActualOutputTokens(null);

        // Track streaming chunks for estimation
        bus.on(
            'llm:chunk',
            (payload) => {
                if (payload.chunkType === 'text') {
                    charCountRef.current += payload.content.length;
                    setEstimatedOutputTokens(estimateTokens(charCountRef.current));
                }
            },
            { signal }
        );

        // Get actual counts from response
        bus.on(
            'llm:response',
            (payload) => {
                if (payload.tokenUsage?.outputTokens !== undefined) {
                    setActualOutputTokens(payload.tokenUsage.outputTokens);
                }
            },
            { signal }
        );

        // Reset on thinking (new turn in multi-turn)
        bus.on(
            'llm:thinking',
            () => {
                charCountRef.current = 0;
                setEstimatedOutputTokens(0);
                setActualOutputTokens(null);
            },
            { signal }
        );

        return () => {
            controller.abort();
        };
    }, [agent, isActive]);

    const hasActualCounts = actualOutputTokens !== null;
    const displayCount = hasActualCounts ? actualOutputTokens : estimatedOutputTokens;

    return {
        estimatedOutputTokens,
        actualOutputTokens,
        hasActualCounts,
        formatted: formatTokenCount(displayCount, !hasActualCounts),
    };
}
