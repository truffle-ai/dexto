import { describe, it, expect } from 'vitest';
import { LLM_PROVIDERS } from './types.js';
import {
    LLM_REGISTRY,
    getSupportedProviders,
    getSupportedModels,
    getMaxInputTokensForModel,
    isValidProviderModel,
    getProviderFromModel,
    getAllSupportedModels,
    getEffectiveMaxInputTokens,
    supportsBaseURL,
    requiresBaseURL,
    acceptsAnyModel,
    getDefaultModelForProvider,
    getSupportedFileTypesForModel,
    modelSupportsFileType,
    validateModelFileSupport,
    getSupportedRoutersForProvider,
    isRouterSupportedForProvider,
    isRouterSupportedForModel,
    getSupportedRoutersForModel,
} from './registry.js';
import { LLMErrorCode } from './error-codes.js';
import { ErrorScope, ErrorType } from '../errors/types.js';

describe('LLM Registry Core Functions', () => {
    describe('getSupportedProviders', () => {
        it('returns all provider keys from registry', () => {
            const providers = getSupportedProviders();
            expect(providers).toEqual(Object.keys(LLM_REGISTRY));
        });
    });

    describe('getSupportedModels', () => {
        it('returns models for known provider', () => {
            const expected = LLM_REGISTRY.openai.models.map((m) => m.name);
            expect(getSupportedModels('openai')).toEqual(expected);
        });
    });

    describe('getMaxInputTokensForModel', () => {
        it('returns correct maxInputTokens for valid provider and model', () => {
            expect(getMaxInputTokensForModel('openai', 'o4-mini')).toBe(200000);
        });

        it('throws DextoRuntimeError with model unknown code for unknown model', () => {
            expect(() => getMaxInputTokensForModel('openai', 'unknown-model')).toThrow(
                expect.objectContaining({
                    code: LLMErrorCode.MODEL_UNKNOWN,
                    scope: ErrorScope.LLM,
                    type: ErrorType.USER,
                })
            );
        });
    });

    describe('isValidProviderModel', () => {
        it('returns true for valid provider-model combinations', () => {
            expect(isValidProviderModel('openai', 'o4-mini')).toBe(true);
        });

        it('returns false for invalid model', () => {
            expect(isValidProviderModel('openai', 'unknown-model')).toBe(false);
        });
    });

    describe('getProviderFromModel', () => {
        it('returns correct provider for valid model', () => {
            expect(getProviderFromModel('o4-mini')).toBe('openai');
        });

        it('throws CantInferProviderError for unknown model', () => {
            expect(() => getProviderFromModel('unknown-model')).toThrow(
                expect.objectContaining({
                    code: LLMErrorCode.MODEL_UNKNOWN,
                    scope: ErrorScope.LLM,
                    type: ErrorType.USER,
                })
            );
        });
    });

    describe('getAllSupportedModels', () => {
        it('returns all models from all providers', () => {
            const allModels = getAllSupportedModels();
            const expected = Object.values(LLM_REGISTRY).flatMap((info) =>
                info.models.map((m) => m.name)
            );
            expect(allModels).toEqual(expected);
        });
    });

    describe('getDefaultModelForProvider', () => {
        it('returns default model for provider with default', () => {
            expect(getDefaultModelForProvider('openai')).toBe('gpt-4.1-mini');
            expect(getDefaultModelForProvider('groq')).toBe('llama-3.3-70b-versatile');
        });

        it('returns null for provider without default (openai-compatible)', () => {
            expect(getDefaultModelForProvider('openai-compatible')).toBe(null);
        });
    });
});

describe('Router Support Functions', () => {
    describe('getSupportedRoutersForProvider', () => {
        it('returns correct routers for providers supporting both', () => {
            expect(getSupportedRoutersForProvider('openai')).toEqual(['vercel', 'in-built']);
            expect(getSupportedRoutersForProvider('anthropic')).toEqual(['vercel', 'in-built']);
        });

        it('returns vercel only for providers with limited router support', () => {
            expect(getSupportedRoutersForProvider('google')).toEqual(['vercel']);
            expect(getSupportedRoutersForProvider('groq')).toEqual(['vercel']);
            expect(getSupportedRoutersForProvider('xai')).toEqual(['vercel']);
            expect(getSupportedRoutersForProvider('cohere')).toEqual(['vercel']);
        });
    });

    describe('isRouterSupportedForProvider', () => {
        it('validates router support correctly', () => {
            // Providers supporting both routers
            expect(isRouterSupportedForProvider('openai', 'vercel')).toBe(true);
            expect(isRouterSupportedForProvider('openai', 'in-built')).toBe(true);

            // Providers supporting only vercel
            expect(isRouterSupportedForProvider('google', 'vercel')).toBe(true);
            expect(isRouterSupportedForProvider('google', 'in-built')).toBe(false);
        });
    });
});

describe('Provider Capabilities', () => {
    describe('supportsBaseURL', () => {
        it('returns true for providers supporting baseURL', () => {
            expect(supportsBaseURL('openai-compatible')).toBe(true);
        });

        it('returns false for providers not supporting baseURL', () => {
            expect(supportsBaseURL('openai')).toBe(false);
        });
    });

    describe('requiresBaseURL', () => {
        it('returns true for providers requiring baseURL', () => {
            expect(requiresBaseURL('openai-compatible')).toBe(true);
        });

        it('returns false for providers not requiring baseURL', () => {
            expect(requiresBaseURL('openai')).toBe(false);
        });
    });

    describe('acceptsAnyModel', () => {
        it('returns true for providers accepting any model', () => {
            expect(acceptsAnyModel('openai-compatible')).toBe(true);
        });

        it('returns false for providers with fixed models', () => {
            expect(acceptsAnyModel('openai')).toBe(false);
        });
    });
});

describe('Case Sensitivity', () => {
    it('handles model names case-insensitively across all functions', () => {
        // Test multiple functions with case variations
        expect(getMaxInputTokensForModel('openai', 'O4-MINI')).toBe(200000);
        expect(getMaxInputTokensForModel('openai', 'o4-mini')).toBe(200000);
        expect(isValidProviderModel('openai', 'O4-MINI')).toBe(true);
        expect(isValidProviderModel('openai', 'o4-mini')).toBe(true);
        expect(getProviderFromModel('O4-MINI')).toBe('openai');
        expect(getProviderFromModel('o4-mini')).toBe('openai');
    });
});

describe('Registry Consistency', () => {
    it('maintains consistency between LLM_PROVIDERS and LLM_REGISTRY', () => {
        const registryKeys = Object.keys(LLM_REGISTRY).sort();
        const providersArray = [...LLM_PROVIDERS].sort();
        expect(registryKeys).toEqual(providersArray);
    });

    it('handles all valid LLMProvider enum values correctly', () => {
        LLM_PROVIDERS.forEach((provider) => {
            expect(() => getSupportedModels(provider)).not.toThrow();
            expect(Array.isArray(getSupportedModels(provider))).toBe(true);
            expect(typeof supportsBaseURL(provider)).toBe('boolean');
            expect(typeof requiresBaseURL(provider)).toBe('boolean');
            expect(typeof acceptsAnyModel(provider)).toBe('boolean');
        });
    });
});

describe('getEffectiveMaxInputTokens', () => {
    it('returns explicit override when provided and within registry limit', () => {
        const config = { provider: 'openai', model: 'o4-mini', maxInputTokens: 1000 } as any;
        expect(getEffectiveMaxInputTokens(config)).toBe(1000);
    });

    it('caps override exceeding registry limit to registry value', () => {
        const registryLimit = getMaxInputTokensForModel('openai', 'o4-mini');
        const config = {
            provider: 'openai',
            model: 'o4-mini',
            maxInputTokens: registryLimit + 1,
        } as any;
        expect(getEffectiveMaxInputTokens(config)).toBe(registryLimit);
    });

    it('returns override for unknown model when provided', () => {
        const config = {
            provider: 'openai',
            model: 'unknown-model',
            maxInputTokens: 50000,
        } as any;
        expect(getEffectiveMaxInputTokens(config)).toBe(50000);
    });

    it('defaults to 128000 when baseURL is set and maxInputTokens is missing', () => {
        const config = {
            provider: 'openai-compatible',
            model: 'custom-model',
            baseURL: 'https://example.com',
        } as any;
        expect(getEffectiveMaxInputTokens(config)).toBe(128000);
    });

    it('returns provided maxInputTokens when baseURL is set', () => {
        const config = {
            provider: 'openai-compatible',
            model: 'custom-model',
            baseURL: 'https://example.com',
            maxInputTokens: 12345,
        } as any;
        expect(getEffectiveMaxInputTokens(config)).toBe(12345);
    });

    it('defaults to 128000 for providers accepting any model without baseURL', () => {
        const config = { provider: 'openai-compatible', model: 'any-model' } as any;
        expect(getEffectiveMaxInputTokens(config)).toBe(128000);
    });

    it('uses registry when no override or baseURL is present', () => {
        const registryLimit = getMaxInputTokensForModel('openai', 'o4-mini');
        const config = { provider: 'openai', model: 'o4-mini' } as any;
        expect(getEffectiveMaxInputTokens(config)).toBe(registryLimit);
    });

    it('throws EffectiveMaxInputTokensError when lookup fails without override or baseURL', () => {
        const config = { provider: 'openai', model: 'non-existent-model' } as any;
        expect(() => getEffectiveMaxInputTokens(config)).toThrow(
            expect.objectContaining({
                code: LLMErrorCode.MODEL_UNKNOWN,
                scope: ErrorScope.LLM,
                type: ErrorType.USER,
            })
        );
    });
});

describe('File Support Functions', () => {
    describe('getSupportedFileTypesForModel', () => {
        it('returns correct file types for models with specific support', () => {
            expect(getSupportedFileTypesForModel('openai', 'gpt-4o-audio-preview')).toEqual([
                'audio',
            ]);
            expect(getSupportedFileTypesForModel('openai', 'gpt-5')).toEqual(['pdf', 'image']);
        });

        it('returns empty array for models without file support', () => {
            expect(getSupportedFileTypesForModel('groq', 'gemma-2-9b-it')).toEqual([]);
        });

        it('returns provider supportedFileTypes for openai-compatible with any model', () => {
            expect(getSupportedFileTypesForModel('openai-compatible', 'custom-model')).toEqual([
                'pdf',
                'image',
                'audio',
            ]);
        });

        it('throws DextoRuntimeError for unknown model', () => {
            expect(() => getSupportedFileTypesForModel('openai', 'unknown-model')).toThrow(
                expect.objectContaining({
                    code: LLMErrorCode.MODEL_UNKNOWN,
                    scope: ErrorScope.LLM,
                    type: ErrorType.USER,
                })
            );
        });

        // Case sensitivity already tested in main Case Sensitivity section
    });

    describe('modelSupportsFileType', () => {
        it('returns true for supported model-file combinations', () => {
            expect(modelSupportsFileType('openai', 'gpt-4o-audio-preview', 'audio')).toBe(true);
            expect(modelSupportsFileType('openai', 'gpt-5', 'pdf')).toBe(true);
        });

        it('returns false for unsupported model-file combinations', () => {
            expect(modelSupportsFileType('openai', 'gpt-5', 'audio')).toBe(false);
        });

        it('returns true for openai-compatible models (uses provider capabilities)', () => {
            expect(modelSupportsFileType('openai-compatible', 'custom-model', 'pdf')).toBe(true);
            expect(modelSupportsFileType('openai-compatible', 'custom-model', 'image')).toBe(true);
            expect(modelSupportsFileType('openai-compatible', 'custom-model', 'audio')).toBe(true);
        });

        it('throws error for unknown model', () => {
            expect(() => modelSupportsFileType('openai', 'unknown-model', 'pdf')).toThrow(
                expect.objectContaining({
                    code: LLMErrorCode.MODEL_UNKNOWN,
                    scope: ErrorScope.LLM,
                    type: ErrorType.USER,
                })
            );
        });
    });

    describe('validateModelFileSupport', () => {
        it('validates supported files correctly', () => {
            const result = validateModelFileSupport('openai', 'gpt-4o-audio-preview', 'audio/mp3');
            expect(result.isSupported).toBe(true);
            expect(result.fileType).toBe('audio');
            expect(result.error).toBeUndefined();
        });

        it('rejects unsupported files with descriptive error', () => {
            const result = validateModelFileSupport('openai', 'gpt-5', 'audio/mp3');
            expect(result.isSupported).toBe(false);
            expect(result.fileType).toBe('audio');
            expect(result.error).toBe("Model 'gpt-5' (openai) does not support audio files");
        });

        it('handles unknown MIME types', () => {
            const result = validateModelFileSupport('openai', 'gpt-5', 'application/unknown');
            expect(result.isSupported).toBe(false);
            expect(result.fileType).toBeUndefined();
            expect(result.error).toBe('Unsupported file type: application/unknown');
        });

        it('handles parameterized MIME types correctly', () => {
            // Test audio/webm;codecs=opus (the original issue)
            const webmResult = validateModelFileSupport(
                'openai',
                'gpt-4o-audio-preview',
                'audio/webm;codecs=opus'
            );
            expect(webmResult.isSupported).toBe(true);
            expect(webmResult.fileType).toBe('audio');
            expect(webmResult.error).toBeUndefined();

            // Test other parameterized MIME types
            const mp3Result = validateModelFileSupport(
                'openai',
                'gpt-4o-audio-preview',
                'audio/mpeg;layer=3'
            );
            expect(mp3Result.isSupported).toBe(true);
            expect(mp3Result.fileType).toBe('audio');

            const pdfResult = validateModelFileSupport(
                'openai',
                'gpt-5',
                'application/pdf;version=1.4'
            );
            expect(pdfResult.isSupported).toBe(true);
            expect(pdfResult.fileType).toBe('pdf');

            // Test that unsupported base types with parameters still fail correctly
            const unknownResult = validateModelFileSupport(
                'openai',
                'gpt-5',
                'application/unknown;param=value'
            );
            expect(unknownResult.isSupported).toBe(false);
            expect(unknownResult.error).toBe(
                'Unsupported file type: application/unknown;param=value'
            );
        });

        it('accepts files for openai-compatible provider', () => {
            const pdfResult = validateModelFileSupport(
                'openai-compatible',
                'custom-model',
                'application/pdf'
            );
            expect(pdfResult.isSupported).toBe(true);
            expect(pdfResult.fileType).toBe('pdf');
            expect(pdfResult.error).toBeUndefined();

            const imageResult = validateModelFileSupport(
                'openai-compatible',
                'custom-model',
                'image/jpeg'
            );
            expect(imageResult.isSupported).toBe(true);
            expect(imageResult.fileType).toBe('image');
            expect(imageResult.error).toBeUndefined();
        });

        // Case sensitivity already tested in main Case Sensitivity section
    });
});

describe('Provider-Specific Tests', () => {
    describe('OpenAI provider', () => {
        it('has correct capabilities and models', () => {
            expect(getSupportedProviders()).toContain('openai');
            expect(getSupportedModels('openai')).toContain('o4-mini');
            expect(getDefaultModelForProvider('openai')).toBe('gpt-4.1-mini');
            expect(supportsBaseURL('openai')).toBe(false);
            expect(requiresBaseURL('openai')).toBe(false);
            expect(acceptsAnyModel('openai')).toBe(false);
            expect(getSupportedRoutersForProvider('openai')).toEqual(['vercel', 'in-built']);
        });
    });

    describe('Anthropic provider', () => {
        it('has correct capabilities and models', () => {
            expect(getSupportedProviders()).toContain('anthropic');
            expect(getSupportedModels('anthropic')).toContain('claude-4-sonnet-20250514');
            expect(getSupportedModels('anthropic')).toContain('claude-haiku-4-5-20251001');
            expect(getDefaultModelForProvider('anthropic')).toBe('claude-haiku-4-5-20251001');
            expect(supportsBaseURL('anthropic')).toBe(false);
            expect(requiresBaseURL('anthropic')).toBe(false);
            expect(acceptsAnyModel('anthropic')).toBe(false);
            expect(getSupportedRoutersForProvider('anthropic')).toEqual(['vercel', 'in-built']);
        });
    });

    describe('Google provider', () => {
        it('has correct capabilities and models', () => {
            expect(getSupportedProviders()).toContain('google');
            expect(getSupportedModels('google')).toContain('gemini-2.5-pro');
            expect(getDefaultModelForProvider('google')).toBe('gemini-2.5-pro');
            expect(supportsBaseURL('google')).toBe(false);
            expect(requiresBaseURL('google')).toBe(false);
            expect(acceptsAnyModel('google')).toBe(false);
            expect(getSupportedRoutersForProvider('google')).toEqual(['vercel']);
        });
    });

    describe('OpenAI-Compatible provider', () => {
        it('has correct capabilities for custom endpoints', () => {
            expect(getSupportedProviders()).toContain('openai-compatible');
            expect(getSupportedModels('openai-compatible')).toEqual([]);
            expect(getDefaultModelForProvider('openai-compatible')).toBe(null);
            expect(supportsBaseURL('openai-compatible')).toBe(true);
            expect(requiresBaseURL('openai-compatible')).toBe(true);
            expect(acceptsAnyModel('openai-compatible')).toBe(true);
            expect(getSupportedRoutersForProvider('openai-compatible')).toEqual([
                'vercel',
                'in-built',
            ]);
        });
    });

    describe('Groq provider', () => {
        it('has correct capabilities and models', () => {
            expect(getSupportedProviders()).toContain('groq');
            expect(getSupportedModels('groq')).toContain('llama-3.3-70b-versatile');
            expect(getDefaultModelForProvider('groq')).toBe('llama-3.3-70b-versatile');
            expect(supportsBaseURL('groq')).toBe(false);
            expect(requiresBaseURL('groq')).toBe(false);
            expect(acceptsAnyModel('groq')).toBe(false);
            expect(getSupportedRoutersForProvider('groq')).toEqual(['vercel']);
        });
    });

    describe('XAI provider', () => {
        it('has correct capabilities and models', () => {
            expect(getSupportedProviders()).toContain('xai');
            expect(getSupportedModels('xai')).toContain('grok-4');
            expect(getDefaultModelForProvider('xai')).toBe('grok-4');
            expect(supportsBaseURL('xai')).toBe(false);
            expect(requiresBaseURL('xai')).toBe(false);
            expect(acceptsAnyModel('xai')).toBe(false);
            expect(getSupportedRoutersForProvider('xai')).toEqual(['vercel']);
        });
    });

    describe('Cohere provider', () => {
        it('has correct capabilities and models', () => {
            expect(getSupportedProviders()).toContain('cohere');
            expect(getSupportedModels('cohere')).toContain('command-a-03-2025');
            expect(getDefaultModelForProvider('cohere')).toBe('command-a-03-2025');
            expect(supportsBaseURL('cohere')).toBe(false);
            expect(requiresBaseURL('cohere')).toBe(false);
            expect(acceptsAnyModel('cohere')).toBe(false);
            expect(getSupportedRoutersForProvider('cohere')).toEqual(['vercel']);
        });

        it('validates all cohere models correctly', () => {
            const cohereModels = [
                'command-a-03-2025',
                'command-r-plus',
                'command-r',
                'command-r7b',
            ];
            cohereModels.forEach((model) => {
                expect(isValidProviderModel('cohere', model)).toBe(true);
            });
            expect(isValidProviderModel('cohere', 'non-existent')).toBe(false);
        });

        it('returns correct maxInputTokens for cohere models', () => {
            expect(getMaxInputTokensForModel('cohere', 'command-a-03-2025')).toBe(256000);
            expect(getMaxInputTokensForModel('cohere', 'command-r-plus')).toBe(128000);
            expect(getMaxInputTokensForModel('cohere', 'command-r')).toBe(128000);
            expect(getMaxInputTokensForModel('cohere', 'command-r7b')).toBe(128000);
        });
    });
});

describe('Model-Specific Router Support Functions', () => {
    describe('isRouterSupportedForModel', () => {
        it('validates GPT-5 models support both routers after v5 migration', () => {
            // GPT-5 models now support both routers (vercel + in-built)
            expect(isRouterSupportedForModel('openai', 'gpt-5', 'in-built')).toBe(true);
            expect(isRouterSupportedForModel('openai', 'gpt-5', 'vercel')).toBe(true);
            expect(isRouterSupportedForModel('openai', 'gpt-5-mini', 'in-built')).toBe(true);
            expect(isRouterSupportedForModel('openai', 'gpt-5-mini', 'vercel')).toBe(true);
            expect(isRouterSupportedForModel('openai', 'gpt-5-nano', 'in-built')).toBe(true);
            expect(isRouterSupportedForModel('openai', 'gpt-5-nano', 'vercel')).toBe(true);
        });

        it('validates other OpenAI models support both routers', () => {
            // Other OpenAI models should support both routers
            expect(isRouterSupportedForModel('openai', 'gpt-4.1-mini', 'in-built')).toBe(true);
            expect(isRouterSupportedForModel('openai', 'gpt-4.1-mini', 'vercel')).toBe(true);
        });

        it('falls back to provider-level support for unknown models', () => {
            // Unknown models should fall back to provider-level support
            expect(isRouterSupportedForModel('openai', 'unknown-model', 'in-built')).toBe(true);
            expect(isRouterSupportedForModel('openai', 'unknown-model', 'vercel')).toBe(true);
            expect(isRouterSupportedForModel('google', 'unknown-model', 'in-built')).toBe(false);
            expect(isRouterSupportedForModel('google', 'unknown-model', 'vercel')).toBe(true);
        });
    });

    describe('getSupportedRoutersForModel', () => {
        it('returns both routers for GPT-5 models after v5 migration', () => {
            expect(getSupportedRoutersForModel('openai', 'gpt-5')).toEqual(['vercel', 'in-built']);
            expect(getSupportedRoutersForModel('openai', 'gpt-5-mini')).toEqual([
                'vercel',
                'in-built',
            ]);
            expect(getSupportedRoutersForModel('openai', 'gpt-5-nano')).toEqual([
                'vercel',
                'in-built',
            ]);
        });

        it('returns both routers for other OpenAI models', () => {
            expect(getSupportedRoutersForModel('openai', 'gpt-4.1-mini')).toEqual([
                'vercel',
                'in-built',
            ]);
            expect(getSupportedRoutersForModel('openai', 'gpt-5')).toEqual(['vercel', 'in-built']);
        });

        it('falls back to provider-level support for unknown models', () => {
            expect(getSupportedRoutersForModel('openai', 'unknown-model')).toEqual([
                'vercel',
                'in-built',
            ]);
            expect(getSupportedRoutersForModel('google', 'unknown-model')).toEqual(['vercel']);
        });
    });
});
