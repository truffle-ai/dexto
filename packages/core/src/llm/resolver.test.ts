import { describe, expect, it } from 'vitest';
import { createMockLogger } from '../logger/v2/test-utils.js';
import { LLMErrorCode } from './error-codes.js';
import { resolveAndValidateLLMConfig } from './resolver.js';
import { LLMConfigSchema } from './schemas.js';

const mockLogger = createMockLogger();

const baseConfig = LLMConfigSchema.parse({
    provider: 'openai',
    model: 'gpt-5',
    apiKey: 'sk-test-1234567890',
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
            { provider: 'dexto', model: 'gpt-5', apiKey: 'dexto-test-1234567890' },
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
});
