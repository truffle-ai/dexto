import { calculateCostBreakdown, getModelPricing, type TokenUsageCostBreakdown } from '@dexto/llm';
import type { LLMProvider, LLMPricingStatus, TokenUsage } from './types.js';

export interface LLMUsagePricingMetadata {
    estimatedCost?: number;
    pricingStatus?: LLMPricingStatus;
    costBreakdown?: TokenUsageCostBreakdown;
}

function finiteTokenCount(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function normalizeTokenUsageForAccounting(tokenUsage: TokenUsage | undefined): TokenUsage {
    const reasoningTokens = finiteTokenCount(tokenUsage?.reasoningTokens);

    return {
        inputTokens: finiteTokenCount(tokenUsage?.inputTokens) ?? 0,
        outputTokens: finiteTokenCount(tokenUsage?.outputTokens) ?? 0,
        totalTokens: finiteTokenCount(tokenUsage?.totalTokens) ?? 0,
        cacheReadTokens: finiteTokenCount(tokenUsage?.cacheReadTokens) ?? 0,
        cacheWriteTokens: finiteTokenCount(tokenUsage?.cacheWriteTokens) ?? 0,
        ...(reasoningTokens !== undefined && { reasoningTokens }),
    };
}

export function hasMeaningfulTokenUsage(tokenUsage: TokenUsage | undefined): boolean {
    if (!tokenUsage) {
        return false;
    }

    const normalized = normalizeTokenUsageForAccounting(tokenUsage);
    return (
        (normalized.inputTokens ?? 0) > 0 ||
        (normalized.outputTokens ?? 0) > 0 ||
        (normalized.reasoningTokens ?? 0) > 0 ||
        (normalized.cacheReadTokens ?? 0) > 0 ||
        (normalized.cacheWriteTokens ?? 0) > 0 ||
        (normalized.totalTokens ?? 0) > 0
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

    // TODO(llm-pricing): Handle totalTokens-only usage without reporting a false zero-cost
    // estimate. calculateCostBreakdown() prices detailed token buckets only, so this path should
    // eventually distinguish "insufficient token detail" from a real zero-cost estimate.
    const costBreakdown = calculateCostBreakdown(tokenUsage, pricing);
    return {
        estimatedCost: costBreakdown.totalUsd,
        pricingStatus: 'estimated',
        costBreakdown,
    };
}
