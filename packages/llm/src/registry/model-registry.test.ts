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

    it('returns defensive pricing clones', () => {
        const bundledModel = getProvider('openai').models[0];
        if (!bundledModel) throw new Error('Expected the bundled OpenAI registry to be populated');

        const registry = createModelRegistry(
            registryWithModel({
                ...bundledModel,
                name: 'pricing-clone-model',
                pricing: {
                    inputPerM: 12,
                    outputPerM: 34,
                    contextOver200kPerM: {
                        inputPerM: 56,
                        outputPerM: 78,
                    },
                },
            })
        );

        const pricing = registry.getModelPricing('openai', 'pricing-clone-model');
        if (!pricing || !pricing.contextOver200kPerM) {
            throw new Error('Expected pricing metadata');
        }
        pricing.inputPerM = 999;
        pricing.contextOver200kPerM.inputPerM = 888;

        expect(registry.getModelPricing('openai', 'pricing-clone-model')).toEqual({
            inputPerM: 12,
            outputPerM: 34,
            contextOver200kPerM: {
                inputPerM: 56,
                outputPerM: 78,
            },
        });
    });

    it('does not mutate the input provider records', () => {
        const bundledCount = LLM_REGISTRY.openai.models.length;
        const registry = createModelRegistry(LLM_REGISTRY);

        const provider = registry.getProvider('openai');
        provider.models.pop();

        expect(registry.getSupportedModels('openai')).toHaveLength(bundledCount);
        expect(LLM_REGISTRY.openai.models).toHaveLength(bundledCount);
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

    it.each([
        'cacheReadPerM',
        'cacheWritePerM',
        'reasoningPerM',
        'inputAudioPerM',
        'outputAudioPerM',
    ])('rejects invalid %s pricing before activation', (field) => {
        const bundledModel = getProvider('openai').models[0];
        if (!bundledModel) throw new Error('Expected the bundled OpenAI registry to be populated');

        expect(() =>
            createModelRegistry(
                registryWithModel({
                    ...bundledModel,
                    name: `invalid-${field}-model`,
                    pricing: {
                        inputPerM: 1,
                        outputPerM: 1,
                        [field]: -1,
                    },
                })
            )
        ).toThrow(expect.objectContaining({ code: 'REGISTRY_INVALID' }));
    });

    it('rejects malformed model fields with a registry error', () => {
        const bundledModel = getProvider('openai').models[0];
        if (!bundledModel) throw new Error('Expected the bundled OpenAI registry to be populated');

        for (const malformedModel of [
            null,
            { ...bundledModel, name: 42 },
            { ...bundledModel, maxInputTokens: Number.NaN },
            { ...bundledModel, supportedFileTypes: 'image' },
        ]) {
            expect(() =>
                createModelRegistry(registryWithModel(malformedModel as ModelInfo))
            ).toThrow(expect.objectContaining({ code: 'REGISTRY_INVALID' }));
        }
    });

    it('rejects unknown supported file types before activation', () => {
        const bundledModel = getProvider('openai').models[0];
        if (!bundledModel) throw new Error('Expected the bundled OpenAI registry to be populated');

        expect(() =>
            createModelRegistry(
                registryWithModel({
                    ...bundledModel,
                    name: 'invalid-file-type-model',
                    supportedFileTypes: ['imag' as ModelInfo['supportedFileTypes'][number]],
                })
            )
        ).toThrow(expect.objectContaining({ code: 'REGISTRY_INVALID' }));
    });

    it('allows zero input-token limits for media models', () => {
        const bundledModel = getProvider('openai').models[0];
        if (!bundledModel) throw new Error('Expected the bundled OpenAI registry to be populated');

        const registry = createModelRegistry(
            registryWithModel({
                ...bundledModel,
                name: 'zero-limit-media-model',
                maxInputTokens: 0,
            })
        );

        expect(registry.getMaxInputTokensForModel('openai', 'zero-limit-media-model')).toBe(0);
    });
});
