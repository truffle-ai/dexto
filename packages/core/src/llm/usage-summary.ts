import { isAssistantMessage, type InternalMessage } from '../context/types.js';
import type { TokenUsage } from './types.js';

export interface CumulativeTokenUsage {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
}

export interface AssistantUsageSummary {
    tokenUsage: CumulativeTokenUsage;
    estimatedCost: number;
    hasUnpricedResponses: boolean;
    modelStats?: AssistantUsageModelStatistics[];
}

export interface AssistantUsageModelStatistics {
    provider: string;
    model: string;
    messageCount: number;
    tokenUsage: CumulativeTokenUsage;
    estimatedCost: number;
}

export function createEmptyCumulativeTokenUsage(): CumulativeTokenUsage {
    return {
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
    };
}

export function createEmptyAssistantUsageSummary(): AssistantUsageSummary {
    return {
        tokenUsage: createEmptyCumulativeTokenUsage(),
        estimatedCost: 0,
        hasUnpricedResponses: false,
    };
}

function hasUnpricedTokenUsage(usage: TokenUsage | undefined): boolean {
    if (!usage) {
        return false;
    }

    return (
        (usage.inputTokens ?? 0) > 0 ||
        (usage.outputTokens ?? 0) > 0 ||
        (usage.reasoningTokens ?? 0) > 0 ||
        (usage.cacheReadTokens ?? 0) > 0 ||
        (usage.cacheWriteTokens ?? 0) > 0 ||
        (usage.totalTokens ?? 0) > 0
    );
}

export function accumulateTokenUsage(
    target: CumulativeTokenUsage,
    usage: TokenUsage | undefined
): void {
    if (!usage) {
        return;
    }

    target.inputTokens += usage.inputTokens ?? 0;
    target.outputTokens += usage.outputTokens ?? 0;
    target.reasoningTokens += usage.reasoningTokens ?? 0;
    target.cacheReadTokens += usage.cacheReadTokens ?? 0;
    target.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
    target.totalTokens += usage.totalTokens ?? 0;
}

export function summarizeAssistantUsage(
    messages: readonly InternalMessage[],
    usageScopeId?: string
): AssistantUsageSummary {
    const summary = createEmptyAssistantUsageSummary();
    const modelStats = new Map<string, AssistantUsageModelStatistics>();

    for (const message of messages) {
        if (!isAssistantMessage(message)) {
            continue;
        }

        if (usageScopeId && message.usageScopeId !== usageScopeId) {
            continue;
        }

        accumulateTokenUsage(summary.tokenUsage, message.tokenUsage);

        if (message.estimatedCost !== undefined) {
            summary.estimatedCost += message.estimatedCost;
        }

        if (
            message.pricingStatus === 'unpriced' ||
            (hasUnpricedTokenUsage(message.tokenUsage) &&
                message.estimatedCost === undefined &&
                message.pricingStatus === undefined)
        ) {
            summary.hasUnpricedResponses = true;
        }

        if (!message.provider || !message.model) {
            continue;
        }

        const modelKey = `${message.provider}:${message.model}`;
        const existingModelStat = modelStats.get(modelKey);
        const modelStat =
            existingModelStat ??
            (() => {
                const newModelStat: AssistantUsageModelStatistics = {
                    provider: message.provider,
                    model: message.model,
                    messageCount: 0,
                    tokenUsage: createEmptyCumulativeTokenUsage(),
                    estimatedCost: 0,
                };
                modelStats.set(modelKey, newModelStat);
                return newModelStat;
            })();

        modelStat.messageCount += 1;
        accumulateTokenUsage(modelStat.tokenUsage, message.tokenUsage);
        if (message.estimatedCost !== undefined) {
            modelStat.estimatedCost += message.estimatedCost;
        }
    }

    if (modelStats.size > 0) {
        summary.modelStats = [...modelStats.values()];
    }

    return summary;
}
