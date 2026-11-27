import { describe, expect, it } from 'vitest';
import { createMockLogger } from '../logger/v2/test-utils.js';
import { LLMErrorCode } from './error-codes.js';
import { resolveAndValidateLLMConfig } from './resolver.js';
import { LLMConfigSchema } from './schemas.js';

const mockLogger = createMockLogger();
const TEST_OPENAI_API_KEY = 'test-openai-key';
const TEST_ANTHROPIC_API_KEY = 'test-anthropic-key';
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
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
            apiKey: TEST_ANTHROPIC_API_KEY,
            reasoning: { variant: 'enabled', budgetTokens: 123 },
        });

        const result = await resolveAndValidateLLMConfig(
            configWithReasoning,
            { maxOutputTokens: 2048 },
            mockLogger
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.reasoning).toEqual({ variant: 'enabled', budgetTokens: 123 });
        }
    });

    it('replaces reasoning config when updates.reasoning is provided (clears previous budgetTokens)', async () => {
        const configWithReasoning = LLMConfigSchema.parse({
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
            apiKey: TEST_ANTHROPIC_API_KEY,
            reasoning: { variant: 'enabled', budgetTokens: 123 },
        });

        const result = await resolveAndValidateLLMConfig(
            configWithReasoning,
            { reasoning: { variant: 'disabled' } },
            mockLogger
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.reasoning).toEqual({ variant: 'disabled' });
        }
    });

    it('clears reasoning config when updates.reasoning is null', async () => {
        const configWithReasoning = LLMConfigSchema.parse({
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
            apiKey: TEST_ANTHROPIC_API_KEY,
            reasoning: { variant: 'enabled', budgetTokens: 123 },
        });

        const result = await resolveAndValidateLLMConfig(
            configWithReasoning,
            { reasoning: null },
            mockLogger
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.reasoning).toBeUndefined();
        }
    });

    it('resets reasoning config when switching model without explicit reasoning update', async () => {
        const configWithReasoning = LLMConfigSchema.parse({
            provider: 'openai',
            model: 'gpt-5',
            apiKey: TEST_OPENAI_API_KEY,
            reasoning: { variant: 'high' },
        });

        const result = await resolveAndValidateLLMConfig(
            configWithReasoning,
            { model: 'gpt-4' },
            mockLogger
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.provider).toBe('openai');
            expect(result.data.model).toBe('gpt-4');
            expect(result.data.reasoning).toBeUndefined();
        }
    });

    it("drops the previous endpoint's baseURL when switching to another provider", async () => {
        const custom = LLMConfigSchema.parse({
            provider: 'openai-compatible',
            model: 'local-model',
            apiKey: 'local-key',
            baseURL: 'http://127.0.0.1:9999/v1',
            maxInputTokens: 32768,
        });

        const result = await resolveAndValidateLLMConfig(
            custom,
            { provider: 'dexto-nova', model: 'openai/gpt-5', apiKey: TEST_DEXTO_API_KEY },
            mockLogger
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.provider).toBe('dexto-nova');
            expect(result.data.baseURL).toBeUndefined();
        }
    });

    it('keeps the baseURL when switching models on the same provider', async () => {
        const custom = LLMConfigSchema.parse({
            provider: 'openai-compatible',
            model: 'local-model',
            apiKey: 'local-key',
            baseURL: 'http://127.0.0.1:9999/v1',
            maxInputTokens: 32768,
        });

        const result = await resolveAndValidateLLMConfig(
            custom,
            { model: 'other-local-model' },
            mockLogger
        );

        expect(result.ok).toBe(true);
        if (result.ok) expect(result.data.baseURL).toBe('http://127.0.0.1:9999/v1');
    });

    it("uses the provider's default endpoint when the update resets baseURL to null", async () => {
        const remoteOllama = LLMConfigSchema.parse({
            provider: 'ollama',
            model: 'llama3.2',
            baseURL: 'http://gpu-box.internal:11434',
            maxInputTokens: 32768,
        });

        const result = await resolveAndValidateLLMConfig(
            remoteOllama,
            { provider: 'ollama', model: 'qwen3', baseURL: null, maxInputTokens: 32768 },
            mockLogger
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.model).toBe('qwen3');
            expect(result.data.baseURL).toBeUndefined();
        }
    });

    it('uses an explicit baseURL from the update over the previous one', async () => {
        const remoteOllama = LLMConfigSchema.parse({
            provider: 'ollama',
            model: 'llama3.2',
            baseURL: 'http://gpu-box.internal:11434',
            maxInputTokens: 32768,
        });

        const result = await resolveAndValidateLLMConfig(
            remoteOllama,
            {
                provider: 'ollama',
                model: 'qwen3',
                baseURL: 'http://other-box.internal:11434',
                maxInputTokens: 32768,
            },
            mockLogger
        );

        expect(result.ok).toBe(true);
        if (result.ok) expect(result.data.baseURL).toBe('http://other-box.internal:11434');
    });
});
