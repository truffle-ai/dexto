import { describe, expect, it } from 'vitest';
import { createModelRegistry, LLM_REGISTRY, type ModelInfo } from '@dexto/llm';
import { createMockLogger } from '../logger/v2/test-utils.js';
import { buildProviderOptions } from './executor/provider-options.js';
import { getEffectiveMaxInputTokens } from './registry/index.js';
import { createLLMConfigSchema, LLMConfigSchema } from './schemas.js';
import { getUsagePricingMetadata } from './usage-metadata.js';
import { validateInputForLLM } from './validation.js';

function createRegistryWithCloudModel(): ReturnType<typeof createModelRegistry> {
    const bundledModel = LLM_REGISTRY.openai.models[0];
    if (!bundledModel) throw new Error('Expected the bundled OpenAI registry to be populated');

    const model: ModelInfo = {
        ...bundledModel,
        name: 'cloud-added-model',
        maxInputTokens: 777,
        reasoning: true,
        supportedFileTypes: ['pdf'],
        pricing: {
            inputPerM: 12,
            outputPerM: 34,
        },
    };

    return createModelRegistry({
        ...LLM_REGISTRY,
        openai: {
            ...LLM_REGISTRY.openai,
            models: [model],
        },
    });
}

describe('active model registry', () => {
    it('validates a model that exists only in the injected registry', () => {
        const registry = createRegistryWithCloudModel();
        const config = {
            provider: 'openai',
            model: 'cloud-added-model',
            apiKey: 'test-openai-key',
            maxIterations: 10,
        };

        expect(LLMConfigSchema.safeParse(config).success).toBe(false);
        expect(createLLMConfigSchema(registry).safeParse(config).success).toBe(true);
    });

    it('uses injected pricing for usage metadata', () => {
        const registry = createRegistryWithCloudModel();

        expect(
            getUsagePricingMetadata({
                provider: 'openai',
                model: 'cloud-added-model',
                tokenUsage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
                llmRegistry: registry,
            })
        ).toMatchObject({
            estimatedCost: 46,
            pricingStatus: 'estimated',
        });
    });

    it('uses injected reasoning metadata and context limits', () => {
        const registry = createRegistryWithCloudModel();
        const logger = createMockLogger();

        expect(
            buildProviderOptions({
                provider: 'openai',
                model: 'cloud-added-model',
                reasoning: { variant: 'high' },
                llmRegistry: registry,
            })
        ).toEqual({
            openai: {
                reasoningEffort: 'high',
                reasoningSummary: 'auto',
            },
        });

        expect(
            getEffectiveMaxInputTokens(
                { provider: 'openai', model: 'cloud-added-model' },
                logger,
                registry
            )
        ).toBe(777);
    });

    it('uses injected file capabilities during input validation', () => {
        const registry = createRegistryWithCloudModel();
        const result = validateInputForLLM(
            {
                fileData: {
                    data: 'SGVsbG8gV29ybGQ=',
                    mimeType: 'application/pdf',
                },
            },
            { provider: 'openai', model: 'cloud-added-model' },
            createMockLogger(),
            registry
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.fileValidation?.isSupported).toBe(true);
        }
    });
});
