import type { InternalMessage } from '../../context/types.js';

export interface RepeatedPrunedToolCall {
    toolName: string;
    /** The new call in the latest assistant message. */
    toolCallId: string;
    /** The most recent earlier identical call whose result was pruned. */
    prunedToolCallId: string;
    /** How many earlier identical calls since the last summary had their results pruned. */
    repeatCount: number;
}

/**
 * Finds calls in the latest assistant message that repeat an earlier call (same tool name and
 * exact argument string) whose result was pruned before this call was made. Only history after
 * the most recent summary is considered.
 */
export function findRepeatedPrunedToolCalls(
    history: Readonly<InternalMessage[]>
): RepeatedPrunedToolCall[] {
    let summaryIndex = -1;
    let latestAssistantIndex = -1;
    history.forEach((message, index) => {
        if (message.metadata?.isSummary === true) summaryIndex = index;
        if (message.role === 'assistant') latestAssistantIndex = index;
    });
    const latestAssistant = history[latestAssistantIndex];
    if (latestAssistant?.role !== 'assistant' || !latestAssistant.toolCalls?.length) return [];

    const earlierHistory = history.slice(summaryIndex + 1, latestAssistantIndex);
    const prunedCallIds = new Set<string>();
    for (const message of earlierHistory) {
        if (message.role === 'tool' && message.compactedAt) prunedCallIds.add(message.toolCallId);
    }
    if (prunedCallIds.size === 0) return [];

    const prunedCallIdsBySignature = new Map<string, string[]>();
    for (const message of earlierHistory) {
        if (message.role !== 'assistant') continue;
        for (const call of message.toolCalls ?? []) {
            if (!prunedCallIds.has(call.id)) continue;
            const signature = `${call.function.name}\0${call.function.arguments}`;
            prunedCallIdsBySignature.set(signature, [
                ...(prunedCallIdsBySignature.get(signature) ?? []),
                call.id,
            ]);
        }
    }

    return latestAssistant.toolCalls.flatMap((call) => {
        const signature = `${call.function.name}\0${call.function.arguments}`;
        const earlierCallIds = prunedCallIdsBySignature.get(signature);
        const prunedToolCallId = earlierCallIds?.at(-1);
        if (earlierCallIds === undefined || prunedToolCallId === undefined) return [];
        return [
            {
                toolName: call.function.name,
                toolCallId: call.id,
                prunedToolCallId,
                repeatCount: earlierCallIds.length,
            },
        ];
    });
}
