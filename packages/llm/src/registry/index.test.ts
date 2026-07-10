import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    calculateCostBreakdown,
    getAllModelsForProvider,
    getModel,
    getModelCapabilities,
    getProvider,
    listModels,
    listProviders,
    resolveGatewayOrigin,
} from './index.js';

describe('@dexto/llm catalog helpers', () => {
    it('does not depend on core, CLI, cloud, filesystem, SQL, or credential packages', () => {
        const llmPackage = JSON.parse(
            readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
        ) as {
            dependencies?: Record<string, string>;
        };
        const dependencyNames = Object.keys(llmPackage.dependencies ?? {});
        expect(dependencyNames).not.toContain('@dexto/core');
        expect(dependencyNames).not.toContain('@dexto/cli');
        expect(dependencyNames).not.toContain('@dexto/server');
        expect(dependencyNames).not.toContain('@dexto/cloud');
        expect(dependencyNames).not.toContain('fs-extra');
        expect(dependencyNames).not.toContain('better-sqlite3');
    });

    it('returns explicit misses for unknown ids', () => {
        expect(getProvider('not-a-provider')).toBeNull();
        expect(getModel('openai', 'not-a-model')).toBeNull();
        expect(getModelCapabilities('openai', 'not-a-model')).toBeNull();
    });

    it('does not expose the unsupported bare GPT-5.6 alias', () => {
        expect(getModel('openai', 'gpt-5.6')).toBeNull();
    });

    it.each(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'])(
        'keeps direct OpenAI %s requests in the short-context tier',
        (modelId) => {
            expect(getModel('openai', modelId)?.maxInputTokens).toBe(272000);
        }
    );

    it('applies GPT-5.6 long-context rates to the entire request above 272K input tokens', () => {
        const pricing = {
            inputPerM: 5,
            outputPerM: 30,
            cacheReadPerM: 0.5,
            cacheWritePerM: 6.25,
            contextOver200kPerM: {
                inputTokensAbove: 272000,
                inputPerM: 10,
                outputPerM: 45,
                cacheReadPerM: 1,
                cacheWritePerM: 12.5,
            },
            currency: 'USD' as const,
            unit: 'per_million_tokens' as const,
        };

        expect(
            calculateCostBreakdown(
                {
                    inputTokens: 200000,
                    outputTokens: 100000,
                    cacheReadTokens: 72000,
                    cacheWriteTokens: 0,
                },
                pricing
            )
        ).toMatchObject({ inputUsd: 1, outputUsd: 3, cacheReadUsd: 0.036, cacheWriteUsd: 0 });

        expect(
            calculateCostBreakdown(
                {
                    inputTokens: 200000,
                    outputTokens: 100000,
                    cacheReadTokens: 72000,
                    cacheWriteTokens: 1,
                },
                pricing
            )
        ).toMatchObject({
            inputUsd: 2,
            outputUsd: 4.5,
            cacheReadUsd: 0.072,
            cacheWriteUsd: 0.0000125,
        });
    });

    it.each([
        ['gpt-5.6-sol', 1, 12.5],
        ['gpt-5.6-terra', 0.5, 6.25],
        ['gpt-5.6-luna', 0.2, 2.5],
    ] as const)(
        'records complete long-context pricing for %s',
        (modelId, cacheRead, cacheWrite) => {
            expect(getModel('openai', modelId)?.pricing?.contextOver200kPerM).toMatchObject({
                inputTokensAbove: 272000,
                cacheReadPerM: cacheRead,
                cacheWritePerM: cacheWrite,
            });
        }
    );

    it('exposes broad string ids without mutating global catalog state', () => {
        const providers = listProviders();
        expect(providers).toContain('openai');
        expect(providers).toContain('dexto-nova');

        const provider = getProvider('openai');
        expect(provider).not.toBeNull();
        provider!.models.length = 0;

        expect(getProvider('openai')!.models.length).toBeGreaterThan(0);
    });

    it('does not expose mutable nested model metadata', () => {
        const providerModel = getProvider('openai')!.models[0]!;
        const originalProviderFileTypes = [...getProvider('openai')!.models[0]!.supportedFileTypes];
        providerModel.supportedFileTypes.length = 0;

        expect(getProvider('openai')!.models[0]!.supportedFileTypes).toEqual(
            originalProviderFileTypes
        );

        const gatewayModel = getAllModelsForProvider('dexto-nova')[0]!;
        const originalGatewayFileTypes = [
            ...getAllModelsForProvider('dexto-nova')[0]!.supportedFileTypes,
        ];
        gatewayModel.supportedFileTypes.length = 0;

        expect(getAllModelsForProvider('dexto-nova')[0]!.supportedFileTypes).toEqual(
            originalGatewayFileTypes
        );
    });

    it('lists gateway models and resolves known OpenRouter-format origins', () => {
        const models = listModels('dexto-nova');
        expect(models.some((entry) => entry.modelId.startsWith('openai/'))).toBe(true);
        expect(resolveGatewayOrigin('dexto-nova', 'openai/gpt-5-mini')).toEqual({
            providerId: 'openai',
            modelId: 'gpt-5-mini',
        });
    });
});
