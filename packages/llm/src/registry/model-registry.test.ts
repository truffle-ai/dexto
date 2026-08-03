import { describe, expect, it } from 'vitest';
import {
    createModelRegistry,
    getProvider,
    LLM_REGISTRY,
    type LLMProvider,
    type ModelInfo,
    type ProviderInfo,
} from './index.js';

function registryWithModel(model: ModelInfo): Record<LLMProvider, ProviderInfo> {
    return {
        ...LLM_REGISTRY,
        openai: {
            ...LLM_REGISTRY.openai,
            models: [model],
        },
    };
}

describe('ModelRegistry', () => {
    it('uses injected model metadata for lookup, pricing, limits, and reasoning', () => {
        const bundledModel = getProvider('openai').models[0];
        if (!bundledModel) throw new Error('Expected the bundled OpenAI registry to be populated');

        const registry = createModelRegistry(
            registryWithModel({
                ...bundledModel,
                name: 'registry-test-model',
                maxInputTokens: 777,
                reasoning: true,
                pricing: {
                    inputPerM: 12,
                    outputPerM: 34,
                },
            })
        );

        expect(registry.getModel('openai', 'registry-test-model')?.name).toBe(
            'registry-test-model'
        );
        expect(registry.getMaxInputTokensForModel('openai', 'registry-test-model')).toBe(777);
        expect(registry.getModelPricing('openai', 'registry-test-model')).toEqual({
            inputPerM: 12,
            outputPerM: 34,
        });
        expect(registry.isReasoningCapableModel('registry-test-model', 'openai')).toBe(true);
        expect(registry.getSupportedModels('openai')).toEqual(['registry-test-model']);
    });

    it('does not mutate the input provider records', () => {
        const registry = createModelRegistry(LLM_REGISTRY);

        const provider = registry.getProvider('openai');
        provider.models.pop();

        expect(registry.getSupportedModels('openai').length).toBeGreaterThan(0);
        expect(LLM_REGISTRY.openai.models.length).toBeGreaterThan(0);
    });

    it('rejects invalid model pricing before activation', () => {
        const bundledModel = getProvider('openai').models[0];
        if (!bundledModel) throw new Error('Expected the bundled OpenAI registry to be populated');

        expect(() =>
            createModelRegistry(
                registryWithModel({
                    ...bundledModel,
                    name: 'invalid-price-model',
                    pricing: {
                        inputPerM: -1,
                        outputPerM: 1,
                    },
                })
            )
        ).toThrow("Invalid registry pricing for 'openai/invalid-price-model'");
    });
});
