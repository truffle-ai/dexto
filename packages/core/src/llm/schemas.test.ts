import { describe, it, expect, vi } from 'vitest';

// Mock logger to prevent initialization issues
vi.mock('../logger/index.js', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));
import { z } from 'zod';
import { LLMErrorCode } from './error-codes.js';
import {
    LLMConfigSchema,
    LLMUpdatesSchema,
    type LLMConfig,
    type ValidatedLLMConfig,
} from './schemas.js';
import { LLM_PROVIDERS } from './types.js';
import {
    getSupportedModels,
    getMaxInputTokensForModel,
    requiresBaseURL,
    supportsBaseURL,
    getDefaultModelForProvider,
    acceptsAnyModel,
} from './registry/index.js';
import type { LLMProvider } from './types.js';

function getIssueParamCode(issue: z.ZodIssue | undefined): unknown {
    if (!issue) return undefined;
    const params = Reflect.get(issue, 'params');
    if (typeof params !== 'object' || params === null) return undefined;
    return Reflect.get(params, 'code');
}

// Test helpers
class LLMTestHelpers {
    static getValidConfigForProvider(provider: LLMProvider): LLMConfig {
        const models = getSupportedModels(provider);
        const defaultModel = getDefaultModelForProvider(provider) || models[0] || 'custom-model';

        const baseConfig = {
            provider,
            model: defaultModel,
            apiKey: 'test-key',
        };

        if (requiresBaseURL(provider)) {
            return { ...baseConfig, baseURL: 'https://api.test.com/v1' };
        }

        return baseConfig;
    }

    static getProviderRequiringBaseURL(): LLMProvider | null {
        return LLM_PROVIDERS.find((p) => requiresBaseURL(p)) || null;
    }

    static getProviderNotSupportingBaseURL(): LLMProvider | null {
        return LLM_PROVIDERS.find((p) => !supportsBaseURL(p)) || null;
    }
}

describe('LLMConfigSchema', () => {
    describe('Basic Structure Validation', () => {
        it('should accept valid minimal config', () => {
            const config = LLMTestHelpers.getValidConfigForProvider('openai');
            const result = LLMConfigSchema.parse(config);

            expect(result.provider).toBe('openai');
            expect(result.model).toBeTruthy();
            expect(result.apiKey).toBe('test-key');
        });

        it('should apply default values', () => {
            const config = LLMTestHelpers.getValidConfigForProvider('openai');
            const result = LLMConfigSchema.parse(config);

            expect(result.maxIterations).toBeUndefined();
        });

        it('should preserve explicit optional values', () => {
            const config: LLMConfig = {
                provider: 'openai',
                model: 'gpt-5',
                apiKey: 'test-key',
                maxIterations: 25,
                temperature: 0.7,
                maxOutputTokens: 4000,
            };

            const result = LLMConfigSchema.parse(config);
            expect(result.maxIterations).toBe(25);
            expect(result.temperature).toBe(0.7);
            expect(result.maxOutputTokens).toBe(4000);
        });
    });

    describe('Required Fields Validation', () => {
        it('should require provider field', () => {
            const config = {
                model: 'gpt-5',
                apiKey: 'test-key',
            };

            const result = LLMConfigSchema.safeParse(config);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.path).toEqual(['provider']);
        });

        it('should require model field', () => {
            const config = {
                provider: 'openai',
                apiKey: 'test-key',
            };

            const result = LLMConfigSchema.safeParse(config);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.path).toEqual(['model']);
        });

        it('should allow missing apiKey (runtime resolves from environment)', () => {
            const config = {
                provider: 'openai',
                model: 'gpt-5',
            };

            const result = LLMConfigSchema.safeParse(config);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.apiKey).toBeUndefined();
            }
        });
    });

    describe('Provider Validation', () => {
        it('should accept all registry providers', () => {
            for (const provider of LLM_PROVIDERS) {
                const config = LLMTestHelpers.getValidConfigForProvider(provider);
                const result = LLMConfigSchema.safeParse(config);
                expect(result.success).toBe(true);
                if (result.success) {
                    expect(result.data.provider).toBe(provider);
                }
            }
        });

        it('should reject invalid providers', () => {
            const config = {
                provider: 'invalid-provider',
                model: 'test-model',
                apiKey: 'test-key',
            };

            const result = LLMConfigSchema.safeParse(config);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_enum_value);
            expect(result.error?.issues[0]?.path).toEqual(['provider']);
        });

        it('should be case sensitive for providers', () => {
            const config = {
                provider: 'OpenAI', // Should be 'openai'
                model: 'gpt-5',
                apiKey: 'test-key',
            };

            const result = LLMConfigSchema.safeParse(config);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_enum_value);
            expect(result.error?.issues[0]?.path).toEqual(['provider']);
        });
    });

    describe('Model Validation', () => {
        it('should accept known models for each provider', () => {
            for (const provider of LLM_PROVIDERS) {
                const models = getSupportedModels(provider);
                if (models.length === 0) continue; // Skip providers that accept any model

                // Test first few models to avoid excessive test runs
                const modelsToTest = models.slice(0, 3);
                for (const model of modelsToTest) {
                    const config: LLMConfig = {
                        provider,
                        model,
                        apiKey: 'test-key',
                        ...(requiresBaseURL(provider) && { baseURL: 'https://api.test.com/v1' }),
                    };

                    const result = LLMConfigSchema.safeParse(config);
                    expect(result.success).toBe(true);
                }
            }
        });

        it('should reject unknown models for providers with restricted models', () => {
            // Find a provider that has specific model restrictions
            const provider = LLM_PROVIDERS.find((p) => !acceptsAnyModel(p));
            if (!provider) return; // Skip if no providers have model restrictions

            const config: LLMConfig = {
                provider,
                model: 'unknown-model-xyz-123',
                apiKey: 'test-key',
                ...(requiresBaseURL(provider) && { baseURL: 'https://api.test.com/v1' }),
            };

            const result = LLMConfigSchema.safeParse(config);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.path).toEqual(['model']);
            expect(getIssueParamCode(result.error?.issues[0])).toBe(
                LLMErrorCode.MODEL_INCOMPATIBLE
            );
        });
    });

    describe('Temperature Validation', () => {
        it('should accept valid temperature values', () => {
            const validTemperatures = [0, 0.1, 0.5, 0.7, 1.0];

            for (const temperature of validTemperatures) {
                const config: LLMConfig = {
                    ...LLMTestHelpers.getValidConfigForProvider('openai'),
                    temperature,
                };

                const result = LLMConfigSchema.safeParse(config);
                expect(result.success).toBe(true);
                if (result.success) {
                    expect(result.data.temperature).toBe(temperature);
                }
            }
        });

        it('should reject invalid temperature values', () => {
            const invalidTemperatures = [-0.1, -1, 1.1, 2];

            for (const temperature of invalidTemperatures) {
                const config: LLMConfig = {
                    ...LLMTestHelpers.getValidConfigForProvider('openai'),
                    temperature,
                };

                const result = LLMConfigSchema.safeParse(config);
                expect(result.success).toBe(false);
                expect(result.error?.issues[0]?.path).toEqual(['temperature']);
            }
        });
    });

    describe('BaseURL Validation', () => {
        it('should allow missing baseURL for providers that need it (runtime enforces)', () => {
            const provider = LLMTestHelpers.getProviderRequiringBaseURL();
            if (!provider) return; // Skip if no providers require baseURL

            const config = {
                provider,
                model: 'custom-model',
                apiKey: 'test-key',
                // Missing baseURL
            };

            const result = LLMConfigSchema.safeParse(config);
            expect(result.success).toBe(true);
        });

        it('should accept baseURL for providers that require it', () => {
            const provider = LLMTestHelpers.getProviderRequiringBaseURL();
            if (!provider) return;

            const config: LLMConfig = {
                provider,
                model: 'custom-model',
                apiKey: 'test-key',
                baseURL: 'https://api.custom.com/v1',
            };

            const result = LLMConfigSchema.safeParse(config);
            expect(result.success).toBe(true);
        });

        it('should reject baseURL for providers that do not support it', () => {
            const provider = LLMTestHelpers.getProviderNotSupportingBaseURL();
            if (!provider) return; // Skip if all providers support baseURL

            const config: LLMConfig = {
                ...LLMTestHelpers.getValidConfigForProvider(provider),
                baseURL: 'https://api.custom.com/v1',
            };
            const result = LLMConfigSchema.safeParse(config);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.path).toEqual(['provider']);
            expect(getIssueParamCode(result.error?.issues[0])).toBe(LLMErrorCode.BASE_URL_INVALID);
        });
    });

    describe('MaxInputTokens Validation', () => {
        it('should accept valid maxInputTokens within model limits', () => {
            // Find a provider with specific models to test token limits
            const provider = LLM_PROVIDERS.find((p) => !acceptsAnyModel(p));
            if (!provider) return;

            const models = getSupportedModels(provider);
            const model = models[0]!;
            const maxTokens = getMaxInputTokensForModel(provider, model);

            const config: LLMConfig = {
                provider,
                model,
                apiKey: 'test-key',
                maxInputTokens: Math.floor(maxTokens / 2), // Well within limit
                ...(requiresBaseURL(provider) && { baseURL: 'https://api.test.com/v1' }),
            };

            const result = LLMConfigSchema.safeParse(config);
            expect(result.success).toBe(true);
        });

        it('should reject maxInputTokens exceeding model limits', () => {
            const provider = LLM_PROVIDERS.find((p) => !acceptsAnyModel(p));
            if (!provider) return;

            const models = getSupportedModels(provider);
            const model = models[0]!;
            const maxTokens = getMaxInputTokensForModel(provider, model);

            const config: LLMConfig = {
                provider,
                model,
                apiKey: 'test-key',
                maxInputTokens: maxTokens + 1000, // Exceed limit
                ...(requiresBaseURL(provider) && { baseURL: 'https://api.test.com/v1' }),
            };

            const result = LLMConfigSchema.safeParse(config);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.path).toEqual(['maxInputTokens']);
            expect(getIssueParamCode(result.error?.issues[0])).toBe(LLMErrorCode.TOKENS_EXCEEDED);
        });

        it('should allow maxInputTokens for providers that accept any model', () => {
            const provider = LLMTestHelpers.getProviderRequiringBaseURL();
            if (!provider || !acceptsAnyModel(provider)) return;

            const config: LLMConfig = {
                provider,
                model: 'custom-model',
                apiKey: 'test-key',
                baseURL: 'https://api.custom.com/v1',
                maxInputTokens: 50000,
            };

            const result = LLMConfigSchema.safeParse(config);
            expect(result.success).toBe(true);
        });
    });

    describe('Edge Cases', () => {
        it('should reject empty string values', () => {
            const testCases = [
                { provider: '', model: 'gpt-5' },
                { provider: 'openai', model: '' },
            ];

            for (const config of testCases) {
                const result = LLMConfigSchema.safeParse(config);
                expect(result.success).toBe(false);
            }
        });

        it('should reject whitespace-only values', () => {
            const testCases = [
                { provider: '   ', model: 'gpt-5' },
                { provider: 'openai', model: '   ' },
            ];

            for (const config of testCases) {
                const result = LLMConfigSchema.safeParse(config);
                expect(result.success).toBe(false);
            }
        });

        it('should handle type coercion for numeric fields', () => {
            const config: unknown = {
                ...LLMTestHelpers.getValidConfigForProvider('openai'),
                maxIterations: '25', // String that should coerce to number
                temperature: '0.7', // String that should coerce to number
            };

            const result = LLMConfigSchema.safeParse(config);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.maxIterations).toBe(25);
                expect(result.data.temperature).toBe(0.7);
            }
        });

        it('should reject invalid numeric coercion', () => {
            const config: unknown = {
                ...LLMTestHelpers.getValidConfigForProvider('openai'),
                maxIterations: 'not-a-number',
            };

            const result = LLMConfigSchema.safeParse(config);
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.issues[0]?.path).toEqual(['maxIterations']);
            }
        });
    });

    describe('Strict Validation', () => {
        it('should reject unknown fields', () => {
            const config: unknown = {
                ...LLMTestHelpers.getValidConfigForProvider('openai'),
                unknownField: 'should-fail',
            };

            const result = LLMConfigSchema.safeParse(config);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.unrecognized_keys);
        });
    });

    describe('Type Safety', () => {
        it('should handle input and output types correctly', () => {
            const input: LLMConfig = LLMTestHelpers.getValidConfigForProvider('openai');
            const result: ValidatedLLMConfig = LLMConfigSchema.parse(input);

            // maxIterations is optional (unlimited when omitted)
            expect(result.maxIterations).toBeUndefined();

            // Should preserve input values
            expect(result.provider).toBe(input.provider);
            expect(result.model).toBe(input.model);
            expect(result.apiKey).toBe(input.apiKey);
        });

        it('should maintain type consistency', () => {
            const config = LLMTestHelpers.getValidConfigForProvider('anthropic');
            const result = LLMConfigSchema.parse(config);

            // TypeScript should infer correct types
            expect(typeof result.provider).toBe('string');
            expect(typeof result.model).toBe('string');
            expect(typeof result.maxIterations).toBe('undefined');
            expect(result.maxIterations).toBeUndefined();
        });
    });

    describe('Reasoning Validation', () => {
        it('rejects unsupported reasoning preset for non-gateway providers', () => {
            const config: LLMConfig = {
                provider: 'openai',
                model: 'gpt-5-pro',
                apiKey: 'test-key',
                reasoning: { preset: 'off' },
            };

            const result = LLMConfigSchema.safeParse(config);
            expect(result.success).toBe(false);
            if (!result.success) {
                const presetIssue = result.error.issues.find(
                    (issue) => issue.path.join('.') === 'reasoning.preset'
                );
                expect(presetIssue).toBeDefined();
            }
        });

        it('rejects reasoning budgetTokens when provider/model does not support them', () => {
            const config: LLMConfig = {
                provider: 'openai',
                model: 'gpt-5',
                apiKey: 'test-key',
                reasoning: { preset: 'medium', budgetTokens: 1024 },
            };

            const result = LLMConfigSchema.safeParse(config);
            expect(result.success).toBe(false);
            if (!result.success) {
                const budgetIssue = result.error.issues.find(
                    (issue) => issue.path.join('.') === 'reasoning.budgetTokens'
                );
                expect(budgetIssue).toBeDefined();
            }
        });
    });

    describe('LLMUpdatesSchema', () => {
        describe('Update Requirements', () => {
            it('should pass validation when model is provided', () => {
                const updates = { model: 'gpt-5' };
                expect(() => LLMUpdatesSchema.parse(updates)).not.toThrow();
            });

            it('should pass validation when provider is provided', () => {
                const updates = { provider: 'openai' };
                expect(() => LLMUpdatesSchema.parse(updates)).not.toThrow();
            });

            it('should pass validation when both model and provider are provided', () => {
                const updates = { model: 'gpt-5', provider: 'openai' };
                expect(() => LLMUpdatesSchema.parse(updates)).not.toThrow();
            });

            it('should allow clearing reasoning config with null', () => {
                const updates = { model: 'gpt-5', reasoning: null } as const;
                expect(() => LLMUpdatesSchema.parse(updates)).not.toThrow();
            });

            it('should still reject null reasoning in full config schema', () => {
                const config = {
                    ...LLMTestHelpers.getValidConfigForProvider('openai'),
                    reasoning: null,
                } as const;
                expect(() => LLMConfigSchema.parse(config)).toThrow();
            });

            it('should reject empty updates object', () => {
                const updates = {};
                expect(() => LLMUpdatesSchema.parse(updates)).toThrow();
            });

            it('should reject updates with only non-key fields (no model/provider)', () => {
                const updates = { maxIterations: 10 } as const;
                expect(() => LLMUpdatesSchema.parse(updates)).toThrow();
            });

            it('should pass validation when model/provider with other fields', () => {
                const updates = { model: 'gpt-5', maxIterations: 10 };
                expect(() => LLMUpdatesSchema.parse(updates)).not.toThrow();
            });

            it('rejects unsupported reasoning preset in updates when provider/model are present', () => {
                const updates = {
                    provider: 'openai',
                    model: 'gpt-5-pro',
                    reasoning: { preset: 'off' },
                } as const;

                expect(() => LLMUpdatesSchema.parse(updates)).toThrow();
            });
        });
    });
});
