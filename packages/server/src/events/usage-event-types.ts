import type { LLMProvider, TokenUsage } from '@dexto/core';

export interface UsageEventCostBreakdown {
    inputUsd: number;
    outputUsd: number;
    reasoningUsd: number;
    cacheReadUsd: number;
    cacheWriteUsd: number;
    totalUsd: number;
}

export interface UsageEvent {
    eventId: string;
    occurredAt: string;
    sessionId: string;
    messageId: string;
    usageScopeId: string;
    provider?: LLMProvider;
    model?: string;
    tokenUsage: TokenUsage;
    estimatedCostUsd?: number;
    costBreakdownUsd?: UsageEventCostBreakdown;
    runtimeId?: string;
    runId?: string;
}

export interface UsageEventBatch {
    events: UsageEvent[];
}

export interface UsageEventDeliveryOptions {
    fetchFn?: typeof globalThis.fetch;
    flushIntervalMs?: number;
    batchSize?: number;
    requestTimeoutMs?: number;
}
