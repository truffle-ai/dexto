import { describe, it, expect, vi } from 'vitest';
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
    stripBedrockRegionPrefix,
    getModelPricing,
    getModelDisplayName,
    resolveModelOrigin,
    transformModelNameForProvider,
    getAllModelsForProvider,
    isModelValidForProvider,
    hasAllRegistryModelsSupport,
} from './registry.js';
import { LLMErrorCode } from './error-codes.js';
import { ErrorScope, ErrorType } from '../errors/types.js';
import type { IDextoLogger } from '../logger/v2/types.js';

// Mock the OpenRouter model registry
vi.mock('./providers/openrouter-model-registry.js', () => ({
    getOpenRouterModelContextLength: vi.fn(),
}));

import { getOpenRouterModelContextLength } from './providers/openrouter-model-registry.js';

const mockLogger: IDextoLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trackException: vi.fn(),
    createChild: vi.fn(function (this: any) {
        return this;
    }),
    destroy: vi.fn(),
} as any;

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
            expect(getMaxInputTokensForModel('openai', 'o4-mini', mockLogger)).toBe(200000);
        });

        it('throws DextoRuntimeError with model unknown code for unknown model', () => {
            expect(() => getMaxInputTokensForModel('openai', 'unknown-model', mockLogger)).toThrow(
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

        it('returns correct provider for OpenRouter format models', () => {
            // Anthropic models
            expect(getProviderFromModel('anthropic/claude-opus-4.5')).toBe('anthropic');
            expect(getProviderFromModel('anthropic/claude-sonnet-4.5')).toBe('anthropic');
            expect(getProviderFromModel('anthropic/claude-haiku-4.5')).toBe('anthropic');

            // OpenAI models
            expect(getProviderFromModel('openai/gpt-5-mini')).toBe('openai');
            expect(getProviderFromModel('openai/o4-mini')).toBe('openai');

            // Google models
            expect(getProviderFromModel('google/gemini-3-flash-preview')).toBe('google');

            // xAI models (note: x-ai prefix)
            expect(getProviderFromModel('x-ai/grok-4')).toBe('xai');

            // Cohere models
            expect(getProviderFromModel('cohere/command-a-03-2025')).toBe('cohere');

            // MiniMax models
            expect(getProviderFromModel('minimax/minimax-m2.1')).toBe('minimax');
            expect(getProviderFromModel('MiniMax-M2.1')).toBe('minimax');

            // GLM models (Zhipu)
            expect(getProviderFromModel('z-ai/glm-4.7')).toBe('glm');
        });

        it('handles case insensitivity for OpenRouter format models', () => {
            expect(getProviderFromModel('ANTHROPIC/claude-opus-4.5')).toBe('anthropic');
            expect(getProviderFromModel('Anthropic/Claude-Opus-4.5')).toBe('anthropic');
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
            expect(getDefaultModelForProvider('openai')).toBe('gpt-5-mini');
            expect(getDefaultModelForProvider('groq')).toBe('llama-3.3-70b-versatile');
        });

        it('returns null for provider without default (openai-compatible)', () => {
            expect(getDefaultModelForProvider('openai-compatible')).toBe(null);
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
        expect(getMaxInputTokensForModel('openai', 'O4-MINI', mockLogger)).toBe(200000);
        expect(getMaxInputTokensForModel('openai', 'o4-mini', mockLogger)).toBe(200000);
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
        expect(getEffectiveMaxInputTokens(config, mockLogger)).toBe(1000);
    });

    it('caps override exceeding registry limit to registry value', () => {
        const registryLimit = getMaxInputTokensForModel('openai', 'o4-mini', mockLogger);
        const config = {
            provider: 'openai',
            model: 'o4-mini',
            maxInputTokens: registryLimit + 1,
        } as any;
        expect(getEffectiveMaxInputTokens(config, mockLogger)).toBe(registryLimit);
    });

    it('returns override for unknown model when provided', () => {
        const config = {
            provider: 'openai',
            model: 'unknown-model',
            maxInputTokens: 50000,
        } as any;
        expect(getEffectiveMaxInputTokens(config, mockLogger)).toBe(50000);
    });

    it('defaults to 128000 when baseURL is set and maxInputTokens is missing', () => {
        const config = {
            provider: 'openai-compatible',
            model: 'custom-model',
            baseURL: 'https://example.com',
        } as any;
        expect(getEffectiveMaxInputTokens(config, mockLogger)).toBe(128000);
    });

    it('returns provided maxInputTokens when baseURL is set', () => {
        const config = {
            provider: 'openai-compatible',
            model: 'custom-model',
            baseURL: 'https://example.com',
            maxInputTokens: 12345,
        } as any;
        expect(getEffectiveMaxInputTokens(config, mockLogger)).toBe(12345);
    });

    it('defaults to 128000 for providers accepting any model without baseURL', () => {
        const config = { provider: 'openai-compatible', model: 'any-model' } as any;
        expect(getEffectiveMaxInputTokens(config, mockLogger)).toBe(128000);
    });

    it('uses registry when no override or baseURL is present', () => {
        const registryLimit = getMaxInputTokensForModel('openai', 'o4-mini', mockLogger);
        const config = { provider: 'openai', model: 'o4-mini' } as any;
        expect(getEffectiveMaxInputTokens(config, mockLogger)).toBe(registryLimit);
    });

    it('throws EffectiveMaxInputTokensError when lookup fails without override or baseURL', () => {
        const config = { provider: 'openai', model: 'non-existent-model' } as any;
        expect(() => getEffectiveMaxInputTokens(config, mockLogger)).toThrow(
            expect.objectContaining({
                code: LLMErrorCode.MODEL_UNKNOWN,
                scope: ErrorScope.LLM,
                type: ErrorType.USER,
            })
        );
    });

    describe('OpenRouter provider', () => {
        it('uses context length from OpenRouter registry when available', () => {
            vi.mocked(getOpenRouterModelContextLength).mockReturnValue(200000);
            const config = {
                provider: 'openrouter',
                model: 'anthropic/claude-3.5-sonnet',
            } as any;
            expect(getEffectiveMaxInputTokens(config, mockLogger)).toBe(200000);
        });

        it('falls back to 128000 when model not in OpenRouter cache', () => {
            vi.mocked(getOpenRouterModelContextLength).mockReturnValue(null);
            const config = {
                provider: 'openrouter',
                model: 'unknown/model',
            } as any;
            expect(getEffectiveMaxInputTokens(config, mockLogger)).toBe(128000);
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('not found in cache')
            );
        });
    });
});

describe('File Support Functions', () => {
    describe('getSupportedFileTypesForModel', () => {
        it('returns correct file types for models with specific support', () => {
            expect(getSupportedFileTypesForModel('google', 'gemini-3-flash-preview')).toEqual([
                'pdf',
                'image',
                'audio',
            ]);
            expect(getSupportedFileTypesForModel('openai', 'gpt-5')).toEqual(['pdf', 'image']);
        });

        it('returns empty array for models without file support', () => {
            expect(getSupportedFileTypesForModel('groq', 'gemma2-9b-it')).toEqual([]);
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
            expect(modelSupportsFileType('google', 'gemini-3-flash-preview', 'audio')).toBe(true);
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
            const result = validateModelFileSupport(
                'google',
                'gemini-3-flash-preview',
                'audio/mp3'
            );
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
                'google',
                'gemini-3-flash-preview',
                'audio/webm;codecs=opus'
            );
            expect(webmResult.isSupported).toBe(true);
            expect(webmResult.fileType).toBe('audio');
            expect(webmResult.error).toBeUndefined();

            // Test other parameterized MIME types
            const mp3Result = validateModelFileSupport(
                'google',
                'gemini-3-flash-preview',
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
            expect(getDefaultModelForProvider('openai')).toBe('gpt-5-mini');
            expect(supportsBaseURL('openai')).toBe(false);
            expect(requiresBaseURL('openai')).toBe(false);
            expect(acceptsAnyModel('openai')).toBe(false);
        });
    });

    describe('Anthropic provider', () => {
        it('has correct capabilities and models', () => {
            expect(getSupportedProviders()).toContain('anthropic');
            expect(getSupportedModels('anthropic')).toContain('claude-sonnet-4-20250514');
            expect(getSupportedModels('anthropic')).toContain('claude-haiku-4-5-20251001');
            expect(getDefaultModelForProvider('anthropic')).toBe('claude-haiku-4-5-20251001');
            expect(supportsBaseURL('anthropic')).toBe(false);
            expect(requiresBaseURL('anthropic')).toBe(false);
            expect(acceptsAnyModel('anthropic')).toBe(false);
        });
    });

    describe('Google provider', () => {
        it('has correct capabilities and models', () => {
            expect(getSupportedProviders()).toContain('google');
            expect(getSupportedModels('google')).toContain('gemini-3-flash-preview');
            expect(getDefaultModelForProvider('google')).toBe('gemini-3-flash-preview');
            expect(supportsBaseURL('google')).toBe(false);
            expect(requiresBaseURL('google')).toBe(false);
            expect(acceptsAnyModel('google')).toBe(false);
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
        });

        it('validates all cohere models correctly', () => {
            const cohereModels = [
                'command-a-03-2025',
                'command-r-plus-08-2024',
                'command-r-08-2024',
                'command-r7b-12-2024',
            ];
            cohereModels.forEach((model) => {
                expect(isValidProviderModel('cohere', model)).toBe(true);
            });
            expect(isValidProviderModel('cohere', 'non-existent')).toBe(false);
        });

        it('returns correct maxInputTokens for cohere models', () => {
            expect(getMaxInputTokensForModel('cohere', 'command-a-03-2025', mockLogger)).toBe(
                256000
            );
            expect(getMaxInputTokensForModel('cohere', 'command-r-plus-08-2024', mockLogger)).toBe(
                128000
            );
            expect(getMaxInputTokensForModel('cohere', 'command-r-08-2024', mockLogger)).toBe(
                128000
            );
            expect(getMaxInputTokensForModel('cohere', 'command-r7b-12-2024', mockLogger)).toBe(
                128000
            );
        });
    });

    describe('OpenRouter provider', () => {
        it('has correct capabilities for gateway routing', () => {
            expect(getSupportedProviders()).toContain('openrouter');
            expect(getSupportedModels('openrouter')).toEqual([]);
            expect(getDefaultModelForProvider('openrouter')).toBe(null);
            expect(supportsBaseURL('openrouter')).toBe(false); // Fixed endpoint, auto-injected in resolver
            expect(requiresBaseURL('openrouter')).toBe(false); // Auto-injected
            expect(acceptsAnyModel('openrouter')).toBe(true);
        });
    });

    describe('LiteLLM provider', () => {
        it('has correct capabilities for proxy routing', () => {
            expect(getSupportedProviders()).toContain('litellm');
            expect(getSupportedModels('litellm')).toEqual([]);
            expect(getDefaultModelForProvider('litellm')).toBe(null);
            expect(supportsBaseURL('litellm')).toBe(true);
            expect(requiresBaseURL('litellm')).toBe(true); // User must provide proxy URL
            expect(acceptsAnyModel('litellm')).toBe(true);
        });

        it('supports all file types for user-hosted proxy', () => {
            expect(getSupportedFileTypesForModel('litellm', 'any-model')).toEqual([
                'pdf',
                'image',
                'audio',
            ]);
        });
    });

    describe('Glama provider', () => {
        it('has correct capabilities for gateway routing', () => {
            expect(getSupportedProviders()).toContain('glama');
            expect(getSupportedModels('glama')).toEqual([]);
            expect(getDefaultModelForProvider('glama')).toBe(null);
            expect(supportsBaseURL('glama')).toBe(false); // Fixed endpoint, auto-injected
            expect(requiresBaseURL('glama')).toBe(false);
            expect(acceptsAnyModel('glama')).toBe(true);
        });

        it('supports all file types for gateway', () => {
            expect(getSupportedFileTypesForModel('glama', 'openai/gpt-4o')).toEqual([
                'pdf',
                'image',
                'audio',
            ]);
        });
    });

    describe('Bedrock provider', () => {
        it('has correct capabilities', () => {
            expect(getSupportedProviders()).toContain('bedrock');
            expect(getSupportedModels('bedrock').length).toBeGreaterThan(0);
            expect(getDefaultModelForProvider('bedrock')).toBe(
                'anthropic.claude-sonnet-4-5-20250929-v1:0'
            );
            expect(supportsBaseURL('bedrock')).toBe(false);
            expect(requiresBaseURL('bedrock')).toBe(false);
            expect(acceptsAnyModel('bedrock')).toBe(false);
        });
    });
});

describe('Bedrock Region Prefix Handling', () => {
    describe('stripBedrockRegionPrefix', () => {
        it('strips eu. prefix', () => {
            expect(stripBedrockRegionPrefix('eu.anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe(
                'anthropic.claude-sonnet-4-5-20250929-v1:0'
            );
        });

        it('strips us. prefix', () => {
            expect(stripBedrockRegionPrefix('us.anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe(
                'anthropic.claude-sonnet-4-5-20250929-v1:0'
            );
        });

        it('strips global. prefix', () => {
            expect(
                stripBedrockRegionPrefix('global.anthropic.claude-sonnet-4-5-20250929-v1:0')
            ).toBe('anthropic.claude-sonnet-4-5-20250929-v1:0');
        });

        it('returns model unchanged when no prefix', () => {
            expect(stripBedrockRegionPrefix('anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe(
                'anthropic.claude-sonnet-4-5-20250929-v1:0'
            );
        });

        it('returns non-bedrock models unchanged', () => {
            expect(stripBedrockRegionPrefix('gpt-5-mini')).toBe('gpt-5-mini');
            expect(stripBedrockRegionPrefix('claude-sonnet-4-5-20250929')).toBe(
                'claude-sonnet-4-5-20250929'
            );
        });
    });

    describe('registry lookups with prefixed models', () => {
        const bedrockModel = 'anthropic.claude-sonnet-4-5-20250929-v1:0';

        it('isValidProviderModel works with prefixed models', () => {
            expect(isValidProviderModel('bedrock', bedrockModel)).toBe(true);
            expect(isValidProviderModel('bedrock', `eu.${bedrockModel}`)).toBe(true);
            expect(isValidProviderModel('bedrock', `us.${bedrockModel}`)).toBe(true);
            expect(isValidProviderModel('bedrock', `global.${bedrockModel}`)).toBe(true);
        });

        it('getProviderFromModel works with prefixed models', () => {
            expect(getProviderFromModel(bedrockModel)).toBe('bedrock');
            expect(getProviderFromModel(`eu.${bedrockModel}`)).toBe('bedrock');
            expect(getProviderFromModel(`us.${bedrockModel}`)).toBe('bedrock');
            expect(getProviderFromModel(`global.${bedrockModel}`)).toBe('bedrock');
        });

        it('getMaxInputTokensForModel works with prefixed models', () => {
            const expected = getMaxInputTokensForModel('bedrock', bedrockModel, mockLogger);
            expect(getMaxInputTokensForModel('bedrock', `eu.${bedrockModel}`, mockLogger)).toBe(
                expected
            );
            expect(getMaxInputTokensForModel('bedrock', `us.${bedrockModel}`, mockLogger)).toBe(
                expected
            );
            expect(getMaxInputTokensForModel('bedrock', `global.${bedrockModel}`, mockLogger)).toBe(
                expected
            );
        });

        it('getSupportedFileTypesForModel works with prefixed models', () => {
            const expected = getSupportedFileTypesForModel('bedrock', bedrockModel);
            expect(getSupportedFileTypesForModel('bedrock', `eu.${bedrockModel}`)).toEqual(
                expected
            );
            expect(getSupportedFileTypesForModel('bedrock', `us.${bedrockModel}`)).toEqual(
                expected
            );
            expect(getSupportedFileTypesForModel('bedrock', `global.${bedrockModel}`)).toEqual(
                expected
            );
        });

        it('getModelPricing works with prefixed models', () => {
            const expected = getModelPricing('bedrock', bedrockModel);
            expect(getModelPricing('bedrock', `eu.${bedrockModel}`)).toEqual(expected);
            expect(getModelPricing('bedrock', `us.${bedrockModel}`)).toEqual(expected);
            expect(getModelPricing('bedrock', `global.${bedrockModel}`)).toEqual(expected);
        });

        it('getModelDisplayName works with prefixed models', () => {
            const expected = getModelDisplayName(bedrockModel, 'bedrock');
            expect(getModelDisplayName(`eu.${bedrockModel}`, 'bedrock')).toBe(expected);
            expect(getModelDisplayName(`us.${bedrockModel}`, 'bedrock')).toBe(expected);
            expect(getModelDisplayName(`global.${bedrockModel}`, 'bedrock')).toBe(expected);
        });
    });
});

describe('resolveModelOrigin', () => {
    describe('for gateway providers (openrouter, dexto)', () => {
        it('resolves OpenRouter format Anthropic models to native format', () => {
            // OpenRouter format → native model name via openrouterId reverse lookup
            const result = resolveModelOrigin('anthropic/claude-opus-4.5', 'openrouter');
            expect(result).toEqual({
                provider: 'anthropic',
                model: 'claude-opus-4-5-20251101',
            });
        });

        it('resolves OpenRouter format models for dexto provider', () => {
            const result = resolveModelOrigin('anthropic/claude-haiku-4.5', 'dexto');
            expect(result).toEqual({
                provider: 'anthropic',
                model: 'claude-haiku-4-5-20251001',
            });
        });

        it('handles case-insensitive OpenRouter format lookups', () => {
            const result = resolveModelOrigin('ANTHROPIC/CLAUDE-OPUS-4.5', 'openrouter');
            expect(result).toEqual({
                provider: 'anthropic',
                model: 'claude-opus-4-5-20251101',
            });
        });

        it('returns extracted model name for OpenRouter format without openrouterId mapping', () => {
            // For models without an explicit openrouterId, falls back to extracting the model name
            const result = resolveModelOrigin('openai/gpt-5-mini', 'openrouter');
            expect(result).toEqual({
                provider: 'openai',
                model: 'gpt-5-mini',
            });
        });

        it('resolves native model names without prefix', () => {
            const result = resolveModelOrigin('claude-haiku-4-5-20251001', 'openrouter');
            expect(result).toEqual({
                provider: 'anthropic',
                model: 'claude-haiku-4-5-20251001',
            });
        });

        it('resolves native model names for OpenAI', () => {
            const result = resolveModelOrigin('o4-mini', 'openrouter');
            expect(result).toEqual({
                provider: 'openai',
                model: 'o4-mini',
            });
        });

        it('returns null for unknown vendor-prefixed models (groq uses native format)', () => {
            // Groq models in our registry don't have vendor prefix (e.g., 'llama-3.3-70b-versatile')
            // But OpenRouter uses 'meta-llama/llama-3.3-70b-versatile'
            // Since the prefixed version isn't in our registry, this returns null
            const result = resolveModelOrigin('meta-llama/llama-3.3-70b-versatile', 'openrouter');
            expect(result).toBeNull();
        });

        it('resolves groq models using native format', () => {
            // Use the native format that's in our registry
            const result = resolveModelOrigin('llama-3.3-70b-versatile', 'openrouter');
            expect(result).toEqual({
                provider: 'groq',
                model: 'llama-3.3-70b-versatile',
            });
        });

        it('returns null for unknown custom models', () => {
            const result = resolveModelOrigin('custom/unknown-model', 'openrouter');
            expect(result).toBeNull();
        });

        it('handles xAI models with x-ai prefix', () => {
            const result = resolveModelOrigin('x-ai/grok-4', 'openrouter');
            expect(result).toEqual({
                provider: 'xai',
                model: 'grok-4',
            });
        });
    });

    describe('for non-gateway providers', () => {
        it('returns the model as-is for providers without supportsAllRegistryModels', () => {
            // OpenAI doesn't support all registry models
            const result = resolveModelOrigin('some-model', 'openai');
            expect(result).toEqual({
                provider: 'openai',
                model: 'some-model',
            });
        });

        it('returns the model as-is for anthropic provider', () => {
            const result = resolveModelOrigin('claude-opus-4-5-20251101', 'anthropic');
            expect(result).toEqual({
                provider: 'anthropic',
                model: 'claude-opus-4-5-20251101',
            });
        });
    });
});

describe('hasAllRegistryModelsSupport', () => {
    it('returns true for dexto provider', () => {
        expect(hasAllRegistryModelsSupport('dexto')).toBe(true);
    });

    it('returns true for openrouter provider', () => {
        expect(hasAllRegistryModelsSupport('openrouter')).toBe(true);
    });

    it('returns false for native providers', () => {
        expect(hasAllRegistryModelsSupport('openai')).toBe(false);
        expect(hasAllRegistryModelsSupport('anthropic')).toBe(false);
        expect(hasAllRegistryModelsSupport('google')).toBe(false);
        expect(hasAllRegistryModelsSupport('groq')).toBe(false);
    });
});

describe('getAllModelsForProvider', () => {
    it('returns only provider models for native providers', () => {
        const openaiModels = getAllModelsForProvider('openai');
        expect(openaiModels.length).toBeGreaterThan(0);
        // Native provider models should not have originalProvider
        expect(
            openaiModels.every(
                (m) => !('originalProvider' in m) || m.originalProvider === undefined
            )
        ).toBe(true);
    });

    it('returns models from all accessible providers for gateway providers', () => {
        const dextoModels = getAllModelsForProvider('dexto');

        // Should have models from multiple providers
        const providers = new Set(dextoModels.map((m) => m.originalProvider));
        expect(providers.size).toBeGreaterThan(1);

        // Should include models from openai, anthropic, google, etc.
        expect(providers.has('openai')).toBe(true);
        expect(providers.has('anthropic')).toBe(true);
        expect(providers.has('google')).toBe(true);
    });

    it('includes originalProvider for gateway provider models', () => {
        const dextoModels = getAllModelsForProvider('dexto');
        expect(dextoModels.every((m) => m.originalProvider !== undefined)).toBe(true);
    });

    it('does not include models from other gateway providers', () => {
        const dextoModels = getAllModelsForProvider('dexto');
        const providers = new Set(dextoModels.map((m) => m.originalProvider));

        // Should NOT include openrouter (another gateway provider)
        expect(providers.has('openrouter')).toBe(false);
    });

    it('includes dexto native models with originalProvider set to dexto', () => {
        const dextoModels = getAllModelsForProvider('dexto');
        const dextoNativeModels = dextoModels.filter((m) => m.originalProvider === 'dexto');

        // Should include dexto's native models like glm-4.7 and minimax-m2.1
        expect(dextoNativeModels.length).toBeGreaterThan(0);
        const dextoNativeModelNames = dextoNativeModels.map((m) => m.name);
        expect(dextoNativeModelNames).toContain('z-ai/glm-4.7');
        expect(dextoNativeModelNames).toContain('minimax/minimax-m2.1');
    });
});

describe('isModelValidForProvider', () => {
    it('returns true for native provider models', () => {
        expect(isModelValidForProvider('openai', 'gpt-5-mini')).toBe(true);
        expect(isModelValidForProvider('anthropic', 'claude-haiku-4-5-20251001')).toBe(true);
    });

    it('returns false for unknown models on native providers', () => {
        expect(isModelValidForProvider('openai', 'unknown-model')).toBe(false);
    });

    it('returns true for any model on gateway providers', () => {
        // Gateway providers with supportsAllRegistryModels can access models from other providers
        expect(isModelValidForProvider('dexto', 'gpt-5-mini')).toBe(true);
        expect(isModelValidForProvider('dexto', 'claude-haiku-4-5-20251001')).toBe(true);
        expect(isModelValidForProvider('openrouter', 'gpt-5-mini')).toBe(true);
    });

    it('returns true for OpenRouter format models on gateway providers', () => {
        expect(isModelValidForProvider('dexto', 'anthropic/claude-opus-4.5')).toBe(true);
        expect(isModelValidForProvider('openrouter', 'openai/gpt-5-mini')).toBe(true);
    });
});

describe('transformModelNameForProvider', () => {
    describe('targeting gateway providers', () => {
        it('transforms Anthropic models using openrouterId', () => {
            const result = transformModelNameForProvider(
                'claude-haiku-4-5-20251001',
                'anthropic',
                'dexto'
            );
            expect(result).toBe('anthropic/claude-haiku-4.5');
        });

        it('transforms OpenAI models using openrouterId', () => {
            const result = transformModelNameForProvider('gpt-5-mini', 'openai', 'dexto');
            expect(result).toBe('openai/gpt-5-mini');
        });

        it('transforms Google models using openrouterId', () => {
            const result = transformModelNameForProvider(
                'gemini-3-flash-preview',
                'google',
                'openrouter'
            );
            expect(result).toBe('google/gemini-3-flash-preview');
        });

        it('transforms xAI models with x-ai prefix', () => {
            const result = transformModelNameForProvider('grok-4', 'xai', 'dexto');
            expect(result).toBe('x-ai/grok-4');
        });

        it('does not transform models already in OpenRouter format', () => {
            const result = transformModelNameForProvider(
                'anthropic/claude-opus-4.5',
                'anthropic',
                'dexto'
            );
            expect(result).toBe('anthropic/claude-opus-4.5');
        });

        it('does not transform groq models (no prefix needed)', () => {
            const result = transformModelNameForProvider(
                'llama-3.3-70b-versatile',
                'groq',
                'dexto'
            );
            expect(result).toBe('llama-3.3-70b-versatile');
        });

        it('does not transform when original provider is a gateway', () => {
            const result = transformModelNameForProvider(
                'anthropic/claude-opus-4.5',
                'dexto',
                'openrouter'
            );
            expect(result).toBe('anthropic/claude-opus-4.5');
        });
    });

    describe('targeting native providers', () => {
        it('returns model unchanged when target is not a gateway', () => {
            const result = transformModelNameForProvider('gpt-5-mini', 'openai', 'openai');
            expect(result).toBe('gpt-5-mini');
        });

        it('returns model unchanged for anthropic target', () => {
            const result = transformModelNameForProvider(
                'claude-haiku-4-5-20251001',
                'anthropic',
                'anthropic'
            );
            expect(result).toBe('claude-haiku-4-5-20251001');
        });
    });

    describe('error handling', () => {
        it('throws for model without openrouterId mapping', () => {
            // Create a scenario where we try to transform a model that doesn't have openrouterId
            // This would be a bug in our registry - all gateway-accessible models should have openrouterId
            expect(() =>
                transformModelNameForProvider('fake-model-no-mapping', 'openai', 'dexto')
            ).toThrow(/has no openrouterId mapping/);
        });
    });
});

describe('Gateway provider integration with lookup functions', () => {
    describe('getMaxInputTokensForModel', () => {
        it('resolves gateway provider to native provider for token lookup', () => {
            // dexto + anthropic model should resolve to anthropic's token limit
            const dextoResult = getMaxInputTokensForModel('dexto', 'claude-haiku-4-5-20251001');
            const anthropicResult = getMaxInputTokensForModel(
                'anthropic',
                'claude-haiku-4-5-20251001'
            );
            expect(dextoResult).toBe(anthropicResult);
        });

        it('handles OpenRouter format models', () => {
            const result = getMaxInputTokensForModel('dexto', 'anthropic/claude-haiku-4.5');
            const expected = getMaxInputTokensForModel('anthropic', 'claude-haiku-4-5-20251001');
            expect(result).toBe(expected);
        });
    });

    describe('getSupportedFileTypesForModel', () => {
        it('resolves gateway provider to native provider for file type lookup', () => {
            const dextoResult = getSupportedFileTypesForModel('dexto', 'claude-haiku-4-5-20251001');
            const anthropicResult = getSupportedFileTypesForModel(
                'anthropic',
                'claude-haiku-4-5-20251001'
            );
            expect(dextoResult).toEqual(anthropicResult);
        });
    });

    describe('getModelPricing', () => {
        it('resolves gateway provider to native provider for pricing lookup', () => {
            const dextoResult = getModelPricing('dexto', 'claude-haiku-4-5-20251001');
            const anthropicResult = getModelPricing('anthropic', 'claude-haiku-4-5-20251001');
            expect(dextoResult).toEqual(anthropicResult);
        });

        it('returns undefined for unknown models on gateway', () => {
            const result = getModelPricing('dexto', 'unknown-custom-model');
            expect(result).toBeUndefined();
        });
    });

    describe('getModelDisplayName', () => {
        it('resolves gateway provider to native provider for display name lookup', () => {
            const dextoResult = getModelDisplayName('claude-haiku-4-5-20251001', 'dexto');
            const anthropicResult = getModelDisplayName('claude-haiku-4-5-20251001', 'anthropic');
            expect(dextoResult).toBe(anthropicResult);
        });

        it('handles OpenRouter format models', () => {
            const result = getModelDisplayName('anthropic/claude-haiku-4.5', 'dexto');
            expect(result).toBe('Claude Haiku 4.5');
        });
    });
});
