import type { TokenUsage } from '@dexto/llm';
import type { StreamProcessorResult } from './types.js';

/**
 * Some providers occasionally close a stream with finish reason "other" before producing an
 * answer: no text, no tool calls and no billed tokens (reasoning may have streamed first). Such a
 * step did nothing, so it is safe to run again.
 */
export function isEmptyModelResponse(
    result: Pick<StreamProcessorResult, 'text' | 'finishReason' | 'usage' | 'toolCalls'>
): boolean {
    return (
        result.finishReason === 'other' &&
        result.text === '' &&
        result.toolCalls.length === 0 &&
        hasZeroUsage(result.usage)
    );
}

function hasZeroUsage(usage: TokenUsage): boolean {
    return (
        (usage.inputTokens ?? 0) === 0 &&
        (usage.outputTokens ?? 0) === 0 &&
        (usage.reasoningTokens ?? 0) === 0 &&
        (usage.totalTokens ?? 0) === 0
    );
}
