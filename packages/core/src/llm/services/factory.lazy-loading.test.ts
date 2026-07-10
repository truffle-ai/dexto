import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LLMConfigSchema } from '../schemas.js';

const providerModules = vi.hoisted(() => ({
    anthropicLoads: 0,
    openaiLoads: 0,
}));

vi.mock('@ai-sdk/openai', () => {
    providerModules.openaiLoads += 1;
    return {
        createOpenAI: () => ({
            responses: (modelId: string) => ({ modelId }),
        }),
    };
});

vi.mock('@ai-sdk/anthropic', () => {
    providerModules.anthropicLoads += 1;
    return {
        createAnthropic: () => (modelId: string) => ({ modelId }),
    };
});

describe('createVercelModel provider loading', () => {
    beforeEach(() => {
        providerModules.anthropicLoads = 0;
        providerModules.openaiLoads = 0;
    });

    it('loads only the SDK for the selected provider', async () => {
        const { createVercelModel } = await import('./factory.js');

        expect(providerModules).toMatchObject({
            anthropicLoads: 0,
            openaiLoads: 0,
        });

        await createVercelModel(
            LLMConfigSchema.parse({
                provider: 'openai',
                model: 'gpt-5-nano',
                apiKey: 'test-key',
            })
        );

        expect(providerModules).toMatchObject({
            anthropicLoads: 0,
            openaiLoads: 1,
        });
    });
});
