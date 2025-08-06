import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { LLMErrorCode } from './error-codes.js';
import { LLMConfigSchema, type LLMConfig, type ValidatedLLMConfig } from './schemas.js';
import {
    LLM_PROVIDERS,
    LLM_ROUTERS,
    getSupportedModels,
    getMaxInputTokensForModel,
    getSupportedRoutersForProvider,
    requiresBaseURL,
    supportsBaseURL,
    getDefaultModelForProvider,
    acceptsAnyModel,
    type LLMProvider,
    type LLMRouter,
} from './registry.js';

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

    static getProviderWithRestrictedRouters(): {
        provider: LLMProvider;
        unsupportedRouter: LLMRouter;
    } | null {
        for (const provider of LLM_PROVIDERS) {
            const supportedRouters = getSupportedRoutersForProvider(provider);
            const unsupportedRouter = LLM_ROUTERS.find((r) => !supportedRouters.includes(r));
            if (unsupportedRouter) {
                return { provider, unsupportedRouter };
            }
        }
        return null;
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

            expect(result.maxIterations).toBe(50);
            expect(result.router).toBe('vercel');
        });

        it('should preserve explicit optional values', () => {
            const config: LLMConfig = {
                provider: 'openai',
                model: 'gpt-4o',
                apiKey: 'test-key',
                maxIterations: 25,
                temperature: 0.7,
                maxOutputTokens: 4000,
                router: 'in-built',
            };

            const result = LLMConfigSchema.parse(config);
            expect(result.maxIterations).toBe(25);
            expect(result.temperature).toBe(0.7);
            expect(result.maxOutputTokens).toBe(4000);
            expect(result.router).toBe('in-built');
        });
    });

    describe('Required Fields Validation', () => {
        it('should require provider field', () => {
            const config = {
                model: 'gpt-4o',
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

        it('should require apiKey field', () => {
            const config = {
                provider: 'openai',
                model: 'gpt-4o',
            };

            const result = LLMConfigSchema.safeParse(config);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.path).toEqual(['apiKey']);
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
                model: 'gpt-4o',
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
            expect((result.error?.issues[0] as any).params?.code).toBe(
                LLMErrorCode.MODEL_INCOMPATIBLE
            );
        });
    });

    describe('Router Validation', () => {
        it('should accept all valid routers', () => {
            for (const router of LLM_ROUTERS) {
                // Find a provider that supports this router
                const provider = LLM_PROVIDERS.find((p) =>
                    getSupportedRoutersForProvider(p).includes(router)
                );
                if (!provider) continue;

                const config: LLMConfig = {
                    ...LLMTestHelpers.getValidConfigForProvider(provider),
                    router,
                };

                const result = LLMConfigSchema.safeParse(config);
                expect(result.success).toBe(true);
            }
        });

        it('should reject invalid routers', () => {
            const config: LLMConfig = {
                ...LLMTestHelpers.getValidConfigForProvider('openai'),
                router: 'invalid-router' as LLMRouter,
            };

            const result = LLMConfigSchema.safeParse(config);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_enum_value);
            expect(result.error?.issues[0]?.path).toEqual(['router']);
        });

        it('should validate router compatibility with providers', () => {
            const incompatible = LLMTestHelpers.getProviderWithRestrictedRouters();
            if (!incompatible) return; // Skip if all providers support all routers

            const config: LLMConfig = {
                ...LLMTestHelpers.getValidConfigForProvider(incompatible.provider),
                router: incompatible.unsupportedRouter,
            };

            const result = LLMConfigSchema.safeParse(config);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.path).toEqual(['router']);
            expect((result.error?.issues[0] as any).params?.code).toBe(
                LLMErrorCode.ROUTER_UNSUPPORTED
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
        it('should require baseURL for providers that need it', () => {
            const provider = LLMTestHelpers.getProviderRequiringBaseURL();
            if (!provider) return; // Skip if no providers require baseURL

            const config = {
                provider,
                model: 'custom-model',
                apiKey: 'test-key',
                // Missing baseURL
            };

            const result = LLMConfigSchema.safeParse(config);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.path).toEqual(['baseURL']);
            expect((result.error?.issues[0] as any).params?.code).toBe(
                LLMErrorCode.BASE_URL_MISSING
            );
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
            expect((result.error?.issues[0] as any).params?.code).toBe(
                LLMErrorCode.BASE_URL_INVALID
            );
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
            expect((result.error?.issues[0] as any).params?.code).toBe(
                LLMErrorCode.TOKENS_EXCEEDED
            );
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
                { provider: '', model: 'gpt-4o', apiKey: 'key' },
                { provider: 'openai', model: '', apiKey: 'key' },
                { provider: 'openai', model: 'gpt-4o', apiKey: '' },
            ];

            for (const config of testCases) {
                const result = LLMConfigSchema.safeParse(config);
                expect(result.success).toBe(false);
            }
        });

        it('should reject whitespace-only values', () => {
            const testCases = [
                { provider: '   ', model: 'gpt-4o', apiKey: 'key' },
                { provider: 'openai', model: '   ', apiKey: 'key' },
                { provider: 'openai', model: 'gpt-4o', apiKey: '   ' },
            ];

            for (const config of testCases) {
                const result = LLMConfigSchema.safeParse(config);
                expect(result.success).toBe(false);
            }
        });

        it('should handle type coercion for numeric fields', () => {
            const config: any = {
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
            const config: any = {
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
            const config: any = {
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

            // Should have applied defaults
            expect(result.maxIterations).toBe(50);
            expect(result.router).toBe('vercel');

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
            expect(typeof result.apiKey).toBe('string');
            expect(typeof result.maxIterations).toBe('number');
            expect(typeof result.router).toBe('string');
        });
    });
});
