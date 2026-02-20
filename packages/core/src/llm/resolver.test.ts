import { describe, expect, it } from 'vitest';
import { createMockLogger } from '../logger/v2/test-utils.js';
import { LLMErrorCode } from './error-codes.js';
import { resolveAndValidateLLMConfig } from './resolver.js';
import { LLMConfigSchema } from './schemas.js';

const mockLogger = createMockLogger();
const TEST_OPENAI_API_KEY = 'test-openai-key';
const TEST_DEXTO_API_KEY = 'test-dexto-key';

const baseConfig = LLMConfigSchema.parse({
    provider: 'openai',
    model: 'gpt-5',
    apiKey: TEST_OPENAI_API_KEY,
    maxIterations: 10,
    maxInputTokens: 128000,
    maxOutputTokens: 4096,
    temperature: 0.2,
});

describe('resolveAndValidateLLMConfig', () => {
    it('returns a validation error (not a throw) for unknown models on fixed registries', async () => {
        const result = await resolveAndValidateLLMConfig(
            baseConfig,
            { provider: 'openai', model: 'definitely-not-a-model' },
            mockLogger
        );

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.issues).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        code: LLMErrorCode.MODEL_INCOMPATIBLE,
                        path: ['model'],
                        severity: 'error',
                    }),
                ])
            );
        }
    });

    it('returns a validation error for gateway providers when model ID is not OpenRouter-format', async () => {
        const result = await resolveAndValidateLLMConfig(
            baseConfig,
            { provider: 'dexto-nova', model: 'gpt-5', apiKey: TEST_DEXTO_API_KEY },
            mockLogger
        );

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.issues).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        code: LLMErrorCode.MODEL_INCOMPATIBLE,
                        path: ['model'],
                        severity: 'error',
                    }),
                ])
            );
        }
    });

    it('preserves reasoning config when applying unrelated updates', async () => {
        const configWithReasoning = LLMConfigSchema.parse({
            provider: 'openai',
            model: 'gpt-5',
            apiKey: TEST_OPENAI_API_KEY,
            reasoning: { preset: 'high', budgetTokens: 123 },
        });

        const result = await resolveAndValidateLLMConfig(
            configWithReasoning,
            { maxOutputTokens: 2048 },
            mockLogger
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.reasoning).toEqual({ preset: 'high', budgetTokens: 123 });
        }
    });

    it('replaces reasoning config when updates.reasoning is provided (clears previous budgetTokens)', async () => {
        const configWithReasoning = LLMConfigSchema.parse({
            provider: 'openai',
            model: 'gpt-5',
            apiKey: TEST_OPENAI_API_KEY,
            reasoning: { preset: 'high', budgetTokens: 123 },
        });

        const result = await resolveAndValidateLLMConfig(
            configWithReasoning,
            { reasoning: { preset: 'low' } },
            mockLogger
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.reasoning).toEqual({ preset: 'low' });
        }
    });
});
