import { calculateCost, getModelPricing } from './registry/index.js';
import type { LLMProvider, LLMPricingStatus, TokenUsage } from './types.js';

export interface LLMUsagePricingMetadata {
    estimatedCost?: number;
    pricingStatus?: LLMPricingStatus;
}

export function hasMeaningfulTokenUsage(tokenUsage: TokenUsage | undefined): boolean {
    if (!tokenUsage) {
        return false;
    }

    return (
        (tokenUsage.inputTokens ?? 0) > 0 ||
        (tokenUsage.outputTokens ?? 0) > 0 ||
        (tokenUsage.reasoningTokens ?? 0) > 0 ||
        (tokenUsage.cacheReadTokens ?? 0) > 0 ||
        (tokenUsage.cacheWriteTokens ?? 0) > 0 ||
        (tokenUsage.totalTokens ?? 0) > 0
    );
}

export function getUsagePricingMetadata(config: {
    provider?: LLMProvider;
    model?: string;
    tokenUsage?: TokenUsage;
}): LLMUsagePricingMetadata {
    const { provider, model, tokenUsage } = config;

    if (!provider || !model || !tokenUsage || !hasMeaningfulTokenUsage(tokenUsage)) {
        return {};
    }

    const pricing = getModelPricing(provider, model);
    if (!pricing) {
        return { pricingStatus: 'unpriced' };
    }

    return {
        estimatedCost: calculateCost(tokenUsage, pricing),
        pricingStatus: 'estimated',
    };
}
