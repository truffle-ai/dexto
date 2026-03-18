import { describe, expect, test } from 'vitest';
import type { InternalMessage } from '../context/types.js';
import { summarizeAssistantUsage } from './usage-summary.js';

describe('summarizeAssistantUsage', () => {
    test('aggregates assistant usage totals and unpriced responses', () => {
        const messages: InternalMessage[] = [
            {
                role: 'user',
                content: [{ type: 'text', text: 'hello' }],
            },
            {
                id: 'assistant-1',
                role: 'assistant',
                content: [{ type: 'text', text: 'response 1' }],
                tokenUsage: {
                    inputTokens: 10,
                    outputTokens: 5,
                    reasoningTokens: 2,
                    cacheReadTokens: 3,
                    cacheWriteTokens: 1,
                    totalTokens: 21,
                },
                estimatedCost: 0.015,
                pricingStatus: 'estimated',
                provider: 'openai',
                model: 'gpt-5',
            },
            {
                id: 'assistant-2',
                role: 'assistant',
                content: [{ type: 'text', text: 'response 2' }],
                tokenUsage: {
                    inputTokens: 7,
                    outputTokens: 4,
                    totalTokens: 11,
                },
                pricingStatus: 'unpriced',
                provider: 'openai',
                model: 'gpt-5',
            },
        ];

        expect(summarizeAssistantUsage(messages)).toEqual({
            tokenUsage: {
                inputTokens: 17,
                outputTokens: 9,
                reasoningTokens: 2,
                cacheReadTokens: 3,
                cacheWriteTokens: 1,
                totalTokens: 32,
            },
            estimatedCost: 0.015,
            unpricedResponseCount: 1,
            modelStats: [
                {
                    provider: 'openai',
                    model: 'gpt-5',
                    messageCount: 2,
                    tokenUsage: {
                        inputTokens: 17,
                        outputTokens: 9,
                        reasoningTokens: 2,
                        cacheReadTokens: 3,
                        cacheWriteTokens: 1,
                        totalTokens: 32,
                    },
                    estimatedCost: 0.015,
                },
            ],
        });
    });

    test('filters totals by usage scope id', () => {
        const messages: InternalMessage[] = [
            {
                id: 'assistant-local',
                role: 'assistant',
                content: [{ type: 'text', text: 'local response' }],
                tokenUsage: {
                    inputTokens: 100,
                    outputTokens: 20,
                    totalTokens: 120,
                },
                estimatedCost: 0.02,
                pricingStatus: 'estimated',
                provider: 'openai',
                model: 'gpt-4o',
            },
            {
                id: 'assistant-cloud',
                role: 'assistant',
                content: [{ type: 'text', text: 'cloud response' }],
                tokenUsage: {
                    inputTokens: 11,
                    outputTokens: 6,
                    cacheReadTokens: 2,
                    totalTokens: 19,
                },
                estimatedCost: 0.004,
                pricingStatus: 'estimated',
                provider: 'openai-compatible',
                model: 'gpt-5.2-codex',
                usageScopeId: 'cloud-agent-1',
            },
            {
                id: 'assistant-cloud-unpriced',
                role: 'assistant',
                content: [{ type: 'text', text: 'cloud response 2' }],
                tokenUsage: {
                    inputTokens: 8,
                    outputTokens: 3,
                    totalTokens: 11,
                },
                pricingStatus: 'unpriced',
                provider: 'openai-compatible',
                model: 'gpt-5.2-codex',
                usageScopeId: 'cloud-agent-1',
            },
        ];

        expect(summarizeAssistantUsage(messages, 'cloud-agent-1')).toEqual({
            tokenUsage: {
                inputTokens: 19,
                outputTokens: 9,
                reasoningTokens: 0,
                cacheReadTokens: 2,
                cacheWriteTokens: 0,
                totalTokens: 30,
            },
            estimatedCost: 0.004,
            unpricedResponseCount: 1,
            modelStats: [
                {
                    provider: 'openai-compatible',
                    model: 'gpt-5.2-codex',
                    messageCount: 2,
                    tokenUsage: {
                        inputTokens: 19,
                        outputTokens: 9,
                        reasoningTokens: 0,
                        cacheReadTokens: 2,
                        cacheWriteTokens: 0,
                        totalTokens: 30,
                    },
                    estimatedCost: 0.004,
                },
            ],
        });
    });
});
