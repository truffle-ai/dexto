/**
 * LLM Model Registry
 *
 * TODO: maxOutputTokens - Currently we rely on @ai-sdk/anthropic (and other provider SDKs)
 * to set appropriate maxOutputTokens defaults per model. As of v2.0.56, @ai-sdk/anthropic
 * has getModelCapabilities() which sets correct limits (e.g., 64000 for claude-haiku-4-5).
 *
 * If we need finer control or want to support models before the SDK does, we could:
 * 1. Add maxOutputTokens to ModelInfo interface
 * 2. Create getMaxOutputTokensForModel() / getEffectiveMaxOutputTokens() helpers
 * 3. Pass explicit maxOutputTokens in TurnExecutor when config doesn't specify one
 *
 * For now, keeping SDK dependency is simpler and auto-updates with SDK releases.
 */

import { LLMConfig } from '../schemas.js';
import { LLMError } from '../errors.js';
import { LLMErrorCode } from '../error-codes.js';
import { DextoRuntimeError } from '../../errors/DextoRuntimeError.js';
import {
    LLM_PROVIDERS,
    type LLMProvider,
    type SupportedFileType,
    type TokenUsage,
} from '../types.js';
import type { Logger } from '../../logger/v2/types.js';
import { getOpenRouterModelContextLength } from '../providers/openrouter-model-registry.js';
import { MODELS_BY_PROVIDER } from './models.generated.js';
import { MANUAL_MODELS_BY_PROVIDER } from './models.manual.js';

const LEGACY_MODEL_ID_ALIASES: Partial<Record<LLMProvider, Record<string, string>>> = {
    anthropic: {
        // Older Dexto configs/tests used "claude-4-{tier}-{date}".
        // models.dev (and our generated snapshot) use "claude-{tier}-4-{date}".
        'claude-4-sonnet-20250514': 'claude-sonnet-4-20250514',
        'claude-4-opus-20250514': 'claude-opus-4-20250514',
    },
};

function getNormalizedModelIdForLookup(provider: LLMProvider, model: string): string {
    const stripped = stripBedrockRegionPrefix(model);
    const lower = stripped.toLowerCase();
    const aliases = LEGACY_MODEL_ID_ALIASES[provider];
    return aliases?.[lower] ?? lower;
}

function mergeModels(base: ModelInfo[], extra: ModelInfo[] | undefined): ModelInfo[] {
    if (!extra || extra.length === 0) return base;

    const merged = [...base];
    const indexByName = new Map<string, number>();
    for (let i = 0; i < merged.length; i++) {
        indexByName.set(merged[i]!.name.toLowerCase(), i);
    }

    for (const m of extra) {
        const key = m.name.toLowerCase();
        const existingIndex = indexByName.get(key);
        if (existingIndex != null) {
            merged[existingIndex] = m;
        } else {
            indexByName.set(key, merged.length);
            merged.push(m);
        }
    }

    return merged;
}

/**
 * Pricing metadata for a model (USD per 1M tokens).
 * Optional; when omitted, pricing is unknown.
 */
export interface ModelPricing {
    inputPerM: number;
    outputPerM: number;
    cacheReadPerM?: number;
    cacheWritePerM?: number;
    currency?: 'USD';
    unit?: 'per_million_tokens';
}

export interface ModelInfo {
    name: string;
    maxInputTokens: number;
    default?: boolean;
    supportedFileTypes: SupportedFileType[]; // Required - every model must explicitly specify file support
    displayName?: string;
    // Pricing metadata (USD per 1M tokens). Optional; when omitted, pricing is unknown.
    pricing?: ModelPricing;
}

// Central list of supported file type identifiers used across server/UI
// Re-exported constants are defined in types.ts for single source of truth
// (imported above): LLM_PROVIDERS, SUPPORTED_FILE_TYPES

// Central MIME type to file type mapping
export const MIME_TYPE_TO_FILE_TYPE: Record<string, SupportedFileType> = {
    'application/pdf': 'pdf',
    'audio/mp3': 'audio',
    'audio/mpeg': 'audio',
    'audio/wav': 'audio',
    'audio/x-wav': 'audio',
    'audio/wave': 'audio',
    'audio/webm': 'audio',
    'audio/ogg': 'audio',
    'audio/m4a': 'audio',
    'audio/aac': 'audio',
    // Common image MIME types
    'image/jpeg': 'image',
    'image/jpg': 'image',
    'image/png': 'image',
    'image/webp': 'image',
    'image/gif': 'image',
};

// Helper function to get array of allowed MIME types
export function getAllowedMimeTypes(): string[] {
    return Object.keys(MIME_TYPE_TO_FILE_TYPE);
}

export interface ProviderInfo {
    models: ModelInfo[];
    baseURLSupport: 'none' | 'optional' | 'required'; // Cleaner single field
    supportedFileTypes: SupportedFileType[]; // Provider-level default, used when model doesn't specify
    supportsCustomModels?: boolean; // Allow arbitrary model IDs beyond fixed list
    /**
     * When true, this provider can access all models from all other providers in the registry.
     * Used for gateway providers like 'dexto-nova' that route to multiple upstream providers.
     * Model names are transformed to the gateway's format (e.g., 'gpt-5-mini' → 'openai/gpt-5-mini').
     */
    supportsAllRegistryModels?: boolean;
}

/** Fallback when we cannot determine the model's input-token limit */
export const DEFAULT_MAX_INPUT_TOKENS = 128000;

// Use imported constant LLM_PROVIDERS

/**
 * LLM Model Registry - Single Source of Truth for Supported models and their capabilities
 *
 * IMPORTANT: supportedFileTypes is the SINGLE SOURCE OF TRUTH for file upload capabilities:
 * - Empty array [] = Model does NOT support file uploads (UI will hide all attach buttons)
 * - Specific types ['image', 'pdf'] = Model supports ONLY those file types
 * - DO NOT use empty arrays as "unknown" - research the model's actual capabilities
 * - The web UI directly reflects these capabilities without fallback logic
 */
export const LLM_REGISTRY: Record<LLMProvider, ProviderInfo> = {
    openai: {
        models: mergeModels(MODELS_BY_PROVIDER.openai, MANUAL_MODELS_BY_PROVIDER.openai),
        baseURLSupport: 'none',
        supportedFileTypes: [], // No defaults - models must explicitly specify support
    },
    'openai-compatible': {
        models: [], // Empty - accepts any model name for custom endpoints
        baseURLSupport: 'required',
        supportedFileTypes: ['pdf', 'image', 'audio'], // Allow all types for custom endpoints
        supportsCustomModels: true,
    },
    anthropic: {
        models: MODELS_BY_PROVIDER.anthropic,
        baseURLSupport: 'none',
        supportedFileTypes: [], // No defaults - models must explicitly specify support
    },
    google: {
        models: MODELS_BY_PROVIDER.google,
        baseURLSupport: 'none',
        supportedFileTypes: [], // No defaults - models must explicitly specify support
    },
    // https://console.groq.com/docs/models
    groq: {
        models: MODELS_BY_PROVIDER.groq,
        baseURLSupport: 'none',
        supportedFileTypes: [], // Groq currently doesn't support file uploads
    },
    // https://docs.x.ai/docs/models
    // Note: XAI API only supports image uploads (JPG/PNG up to 20MB), not PDFs
    xai: {
        models: MODELS_BY_PROVIDER.xai,
        baseURLSupport: 'none',
        supportedFileTypes: [], // No defaults - models must explicitly specify support
    },
    // https://docs.cohere.com/reference/models
    cohere: {
        models: MODELS_BY_PROVIDER.cohere,
        baseURLSupport: 'none',
        supportedFileTypes: [], // No defaults - models must explicitly specify support
    },
    // https://platform.minimax.io/docs/guides/quickstart
    // MiniMax provides an Anthropic-compatible endpoint (models.dev):
    // https://api.minimax.io/anthropic/v1
    minimax: {
        models: MODELS_BY_PROVIDER.minimax,
        baseURLSupport: 'none',
        supportedFileTypes: [], // No defaults - models must explicitly specify support
    },
    // https://api.minimaxi.com/anthropic/v1 (CN)
    'minimax-cn': {
        models: MODELS_BY_PROVIDER['minimax-cn'],
        baseURLSupport: 'none',
        supportedFileTypes: [],
    },
    // Coding plan routes through the same API base URL, but is modeled as a separate provider in models.dev
    'minimax-coding-plan': {
        models: MODELS_BY_PROVIDER['minimax-coding-plan'],
        baseURLSupport: 'none',
        supportedFileTypes: [],
    },
    'minimax-cn-coding-plan': {
        models: MODELS_BY_PROVIDER['minimax-cn-coding-plan'],
        baseURLSupport: 'none',
        supportedFileTypes: [],
    },
    // https://open.bigmodel.cn/dev/api/normal-model/glm-4
    // GLM (Zhipu AI) provides an OpenAI-compatible endpoint
    glm: {
        models: MODELS_BY_PROVIDER.glm,
        baseURLSupport: 'none',
        supportedFileTypes: [], // No defaults - models must explicitly specify support
    },
    // models.dev-aligned aliases/presets
    zhipuai: {
        models: MODELS_BY_PROVIDER.zhipuai,
        baseURLSupport: 'none',
        supportedFileTypes: [],
    },
    'zhipuai-coding-plan': {
        models: MODELS_BY_PROVIDER['zhipuai-coding-plan'],
        baseURLSupport: 'none',
        supportedFileTypes: [],
    },
    zai: {
        models: MODELS_BY_PROVIDER.zai,
        baseURLSupport: 'none',
        supportedFileTypes: [],
    },
    'zai-coding-plan': {
        models: MODELS_BY_PROVIDER['zai-coding-plan'],
        baseURLSupport: 'none',
        supportedFileTypes: [],
    },
    // Moonshot (Kimi) OpenAI-compatible endpoints
    moonshotai: {
        models: MODELS_BY_PROVIDER.moonshotai,
        baseURLSupport: 'none',
        supportedFileTypes: [],
    },
    'moonshotai-cn': {
        models: MODELS_BY_PROVIDER['moonshotai-cn'],
        baseURLSupport: 'none',
        supportedFileTypes: [],
    },
    // Kimi For Coding (Anthropic-compatible)
    'kimi-for-coding': {
        models: MODELS_BY_PROVIDER['kimi-for-coding'],
        baseURLSupport: 'none',
        supportedFileTypes: [],
    },
    // https://openrouter.ai/docs
    // OpenRouter is a unified API gateway providing access to 100+ models from various providers.
    // Model validation is handled dynamically via openrouter-model-registry.ts
    openrouter: {
        models: MODELS_BY_PROVIDER.openrouter,
        baseURLSupport: 'none', // Fixed endpoint - baseURL auto-injected in resolver, no user override allowed
        supportedFileTypes: ['pdf', 'image', 'audio'], // Allow all types - user assumes responsibility
        supportsCustomModels: true,
        supportsAllRegistryModels: true, // Can serve models from all other providers
    },
    // https://docs.litellm.ai/
    // LiteLLM is an OpenAI-compatible proxy that unifies 100+ LLM providers.
    // User must host their own LiteLLM proxy and provide the baseURL.
    litellm: {
        models: [],
        baseURLSupport: 'required',
        supportedFileTypes: ['pdf', 'image', 'audio'],
        supportsCustomModels: true,
    },
    // https://glama.ai/
    // Glama is an OpenAI-compatible gateway providing unified access to multiple LLM providers.
    // Fixed endpoint: https://glama.ai/api/gateway/openai/v1
    glama: {
        models: [],
        baseURLSupport: 'none',
        supportedFileTypes: ['pdf', 'image', 'audio'],
        supportsCustomModels: true,
    },
    // https://cloud.google.com/vertex-ai
    vertex: {
        models: MODELS_BY_PROVIDER.vertex,
        baseURLSupport: 'none',
        supportedFileTypes: [], // No defaults - models must explicitly specify support
    },
    // https://docs.aws.amazon.com/bedrock/latest/userguide/models.html
    bedrock: {
        models: MODELS_BY_PROVIDER.bedrock,
        baseURLSupport: 'none',
        supportedFileTypes: [], // No defaults - models must explicitly specify support
        supportsCustomModels: true,
    },
    // Native local model execution via node-llama-cpp
    local: {
        models: [], // Populated dynamically from local model registry
        baseURLSupport: 'none',
        supportedFileTypes: ['image'],
        supportsCustomModels: true,
    },
    // Ollama server integration
    ollama: {
        models: [], // Populated dynamically from Ollama API
        baseURLSupport: 'optional',
        supportedFileTypes: ['image'],
        supportsCustomModels: true,
    },
    // Dexto Gateway - OpenAI-compatible proxy through api.dexto.ai
    // Routes to OpenRouter with per-request billing (balance decrement)
    // Requires DEXTO_API_KEY from dexto login
    //
    // Model IDs are in OpenRouter format (e.g., 'anthropic/claude-sonnet-4.5')
    'dexto-nova': {
        models: [
            // Claude models (Anthropic via OpenRouter)
            {
                name: 'anthropic/claude-haiku-4.5',
                displayName: 'Claude 4.5 Haiku',
                maxInputTokens: 200000,
                default: true,
                supportedFileTypes: ['pdf', 'image'],
                pricing: {
                    inputPerM: 1.0,
                    outputPerM: 5.0,
                    cacheWritePerM: 1.25,
                    cacheReadPerM: 0.1,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'anthropic/claude-sonnet-4.5',
                displayName: 'Claude 4.5 Sonnet',
                maxInputTokens: 200000,
                supportedFileTypes: ['pdf', 'image'],
                pricing: {
                    inputPerM: 3.0,
                    outputPerM: 15.0,
                    cacheWritePerM: 3.75,
                    cacheReadPerM: 0.3,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'anthropic/claude-opus-4.5',
                displayName: 'Claude 4.5 Opus',
                maxInputTokens: 200000,
                supportedFileTypes: ['pdf', 'image'],
                pricing: {
                    inputPerM: 5.0,
                    outputPerM: 25.0,
                    cacheWritePerM: 6.25,
                    cacheReadPerM: 0.5,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            // OpenAI models (via OpenRouter)
            {
                name: 'openai/gpt-5.2',
                displayName: 'GPT-5.2',
                maxInputTokens: 400000,
                supportedFileTypes: ['pdf', 'image'],
                pricing: {
                    inputPerM: 1.75,
                    outputPerM: 14.0,
                    cacheReadPerM: 0.175,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'openai/gpt-5.2-codex',
                displayName: 'GPT-5.2 Codex',
                maxInputTokens: 400000,
                supportedFileTypes: ['pdf', 'image'],
                pricing: {
                    inputPerM: 1.75,
                    outputPerM: 14.0,
                    cacheReadPerM: 0.175,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            // Google models (via OpenRouter)
            {
                name: 'google/gemini-3-pro-preview',
                displayName: 'Gemini 3 Pro',
                maxInputTokens: 1048576,
                supportedFileTypes: ['pdf', 'image', 'audio'],
            },
            {
                name: 'google/gemini-3-flash-preview',
                displayName: 'Gemini 3 Flash',
                maxInputTokens: 1048576,
                supportedFileTypes: ['pdf', 'image', 'audio'],
            },
            // Free models (via OpenRouter)
            {
                name: 'qwen/qwen3-coder:free',
                displayName: 'Qwen3 Coder (Free)',
                maxInputTokens: 262000,
                supportedFileTypes: [],
            },
            {
                name: 'deepseek/deepseek-r1-0528:free',
                displayName: 'DeepSeek R1 (Free)',
                maxInputTokens: 163840,
                supportedFileTypes: [],
            },
            // Other models (via OpenRouter)
            {
                name: 'z-ai/glm-4.7',
                displayName: 'GLM 4.7',
                maxInputTokens: 202752,
                supportedFileTypes: [],
                pricing: {
                    inputPerM: 0.27,
                    outputPerM: 1.1,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'minimax/minimax-m2.1',
                displayName: 'Minimax M2.1',
                maxInputTokens: 196608,
                supportedFileTypes: [],
                pricing: {
                    inputPerM: 0.2,
                    outputPerM: 0.6,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'moonshotai/kimi-k2.5',
                displayName: 'Kimi K2.5',
                maxInputTokens: 262144,
                supportedFileTypes: ['image'],
                pricing: {
                    inputPerM: 0.5,
                    outputPerM: 2.5,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
        ],
        baseURLSupport: 'none',
        supportedFileTypes: ['pdf', 'image', 'audio'],
        supportsCustomModels: true,
        supportsAllRegistryModels: true,
    },
};

/**
 * Strips Bedrock cross-region inference profile prefix (eu., us., global.) from model ID.
 * This allows registry lookups to work regardless of whether the user specified a prefix.
 * @param model The model ID, potentially with a region prefix
 * @returns The model ID without the region prefix
 */
export function stripBedrockRegionPrefix(model: string): string {
    if (model.startsWith('eu.') || model.startsWith('us.')) {
        return model.slice(3);
    }
    if (model.startsWith('global.')) {
        return model.slice(7);
    }
    return model;
}

/**
 * Gets the default model for a given provider from the registry.
 * @param provider The name of the provider.
 * @returns The default model for the provider, or null if no default model is found.
 */
export function getDefaultModelForProvider(provider: LLMProvider): string | null {
    const providerInfo = LLM_REGISTRY[provider];
    const explicit = providerInfo.models.find((m) => m.default)?.name;
    if (explicit) return explicit;
    if (providerInfo.models.length === 0) return null;

    const sorted = [...providerInfo.models].sort((a, b) => a.name.localeCompare(b.name));
    return sorted[0]?.name ?? null;
}

/**
 * Gets the list of supported providers.
 * @returns An array of supported provider names.
 */
export function getSupportedProviders(): LLMProvider[] {
    return [...LLM_PROVIDERS];
}

/**
 * Gets the list of supported models for a given provider.
 * @param provider The name of the provider.
 * @returns An array of supported model names for the provider.
 */
export function getSupportedModels(provider: LLMProvider): string[] {
    const providerInfo = LLM_REGISTRY[provider];
    return providerInfo.models.map((m) => m.name);
}

/**
 * Retrieves the maximum input token limit for a given provider and model from the registry.
 * For gateway providers with supportsAllRegistryModels, looks up the model in its original provider.
 * @param provider The name of the provider (e.g., 'openai', 'anthropic', 'google').
 * @param model The specific model name.
 * @param logger Optional logger instance for logging. Optional because it's used in zod schema
 * @returns The maximum input token limit for the model.
 * @throws {LLMError} If the model is not found in the registry.
 */
export function getMaxInputTokensForModel(
    provider: LLMProvider,
    model: string,
    logger?: Logger
): number {
    const modelInfo = findModelInfo(provider, model);
    if (!modelInfo) {
        // Gateways can accept arbitrary OpenRouter-format IDs; fall back to OpenRouter's cached catalog
        // for a context length hint when possible.
        if ((provider === 'openrouter' || provider === 'dexto-nova') && model.includes('/')) {
            const contextLength = getOpenRouterModelContextLength(model);
            if (typeof contextLength === 'number') {
                logger?.debug(
                    `Using max tokens from OpenRouter cache for ${provider}/${model}: ${contextLength}`
                );
                return contextLength;
            }
        }

        const supportedModels = getSupportedModels(provider).join(', ');
        logger?.error(
            `Model '${model}' not found for provider '${provider}' in LLM registry. Supported models: ${supportedModels}`
        );
        throw LLMError.unknownModel(provider, model);
    }

    logger?.debug(`Found max tokens for ${provider}/${model}: ${modelInfo.maxInputTokens}`);
    return modelInfo.maxInputTokens;
}

/**
 * Validates if a provider and model combination is supported.
 * Both parameters are required - structural validation (missing values) is handled by Zod schemas.
 * @param provider The provider name.
 * @param model The model name.
 * @returns True if the combination is valid, false otherwise.
 */
export function isValidProviderModel(provider: LLMProvider, model: string): boolean {
    const providerInfo = LLM_REGISTRY[provider];
    const normalizedModel = getNormalizedModelIdForLookup(provider, model);
    return providerInfo.models.some((m) => m.name.toLowerCase() === normalizedModel);
}

/**
 * Infers the LLM provider from the model name by searching the registry.
 * Matches the model name (case-insensitive) against all registered models.
 *
 * @param model The model name (e.g., 'gpt-5-mini', 'claude-sonnet-4-5-20250929')
 * @returns The inferred provider name ('openai', 'anthropic', etc.)
 * @throws {DextoRuntimeError} If no matching provider can be inferred, or if the model is an OpenRouter-format ID.
 */
export function getProviderFromModel(model: string): LLMProvider {
    if (model.includes('/')) {
        // OpenRouter-format IDs ("provider/model") are intentionally not mapped back to a
        // native provider here. Callers should specify the provider explicitly.
        throw LLMError.modelProviderUnknown(model);
    }

    for (const provider of LLM_PROVIDERS) {
        const info = LLM_REGISTRY[provider];
        const normalizedModel = getNormalizedModelIdForLookup(provider, model);
        if (info.models.some((m) => m.name.toLowerCase() === normalizedModel)) {
            return provider;
        }
    }
    throw LLMError.modelProviderUnknown(model);
}

/**
 * Returns a flat array of all supported model names from all providers.
 */
export function getAllSupportedModels(): string[] {
    return Object.values(LLM_REGISTRY).flatMap((info) => info.models.map((m) => m.name));
}

/**
 * Checks if a provider supports custom baseURL.
 * @param provider The name of the provider.
 * @returns True if the provider supports custom baseURL, false otherwise.
 */
export function supportsBaseURL(provider: LLMProvider): boolean {
    const providerInfo = LLM_REGISTRY[provider];
    return providerInfo.baseURLSupport !== 'none';
}

/**
 * Checks if a provider requires a custom baseURL.
 * @param provider The name of the provider.
 * @returns True if the provider requires a custom baseURL, false otherwise.
 */
export function requiresBaseURL(provider: LLMProvider): boolean {
    const providerInfo = LLM_REGISTRY[provider];
    return providerInfo.baseURLSupport === 'required';
}

/**
 * Checks if a provider accepts any model name (i.e., has empty models list).
 * @param provider The name of the provider.
 * @returns True if the provider accepts any model name, false otherwise.
 */
export function acceptsAnyModel(provider: LLMProvider): boolean {
    const providerInfo = LLM_REGISTRY[provider];
    return providerInfo.models.length === 0;
}

/**
 * Checks if a provider supports custom model IDs beyond its fixed model list.
 * This is set explicitly on providers that allow users to add arbitrary model IDs.
 * @param provider The name of the provider.
 * @returns True if the provider supports custom models, false otherwise.
 */
export function supportsCustomModels(provider: LLMProvider): boolean {
    const providerInfo = LLM_REGISTRY[provider];
    return providerInfo.supportsCustomModels === true;
}

/**
 * Checks if a provider supports all registry models from all other providers.
 * @param provider The name of the provider.
 * @returns True if the provider supports all registry models, false otherwise.
 */
export function hasAllRegistryModelsSupport(provider: LLMProvider): boolean {
    const providerInfo = LLM_REGISTRY[provider];
    return providerInfo.supportsAllRegistryModels === true;
}

/**
 * Prefix used for OpenRouter-format model IDs (e.g. "openai/gpt-4.1-mini").
 * This is intentionally kept small and deterministic.
 */
const OPENROUTER_PREFIX_BY_PROVIDER: Partial<Record<LLMProvider, string>> = {
    openai: 'openai',
    anthropic: 'anthropic',
    google: 'google',
    xai: 'x-ai',
    cohere: 'cohere',
    minimax: 'minimax',
    'minimax-cn': 'minimax',
    'minimax-coding-plan': 'minimax',
    'minimax-cn-coding-plan': 'minimax',
    glm: 'z-ai',
    zhipuai: 'z-ai',
    'zhipuai-coding-plan': 'z-ai',
    zai: 'z-ai',
    'zai-coding-plan': 'z-ai',
    moonshotai: 'moonshotai',
    'moonshotai-cn': 'moonshotai',
};

function getOpenRouterModelIdSet(): Set<string> {
    return new Set(LLM_REGISTRY.openrouter.models.map((m) => m.name.toLowerCase()));
}

export function getOpenRouterCandidateModelIds(
    model: string,
    originalProvider: LLMProvider
): string[] {
    if (model.includes('/')) return [model];

    const prefix = OPENROUTER_PREFIX_BY_PROVIDER[originalProvider];
    if (!prefix) return [];

    // Anthropic IDs include dates and use dashes in "X-Y" version segments.
    // OpenRouter uses dotted versions and typically omits the date suffix.
    if (originalProvider === 'anthropic') {
        const noDate = model.replace(/-\d{8}.*$/i, '');
        const dotted = noDate.replace(/-(\d)-(\d)\b/g, '-$1.$2');
        return [`${prefix}/${dotted}`, `${prefix}/${noDate}`, `${prefix}/${model}`];
    }

    // Google Gemini: some models use a "-001" suffix on OpenRouter, but others don't.
    // Prefer whichever exists in the OpenRouter catalog snapshot.
    if (originalProvider === 'google') {
        if (!/^gemini-/i.test(model)) {
            return [`${prefix}/${model}`];
        }
        return [`${prefix}/${model}`, `${prefix}/${model}-001`];
    }

    return [`${prefix}/${model}`];
}

function pickExistingOpenRouterModelId(candidates: string[]): string | null {
    const openrouterSet = getOpenRouterModelIdSet();
    for (const candidate of candidates) {
        if (openrouterSet.has(candidate.toLowerCase())) {
            return candidate;
        }
    }
    return null;
}

function findModelInfo(provider: LLMProvider, model: string): ModelInfo | null {
    const providerInfo = LLM_REGISTRY[provider];
    const normalizedModel = getNormalizedModelIdForLookup(provider, model);
    const direct = providerInfo.models.find((m) => m.name.toLowerCase() === normalizedModel);
    if (direct) return direct;

    // Gateway providers can also surface OpenRouter models (OpenRouter-format IDs with "/").
    if (provider !== 'openrouter' && hasAllRegistryModelsSupport(provider) && model.includes('/')) {
        const openrouterModel = LLM_REGISTRY.openrouter.models.find(
            (m) => m.name.toLowerCase() === model.toLowerCase()
        );
        if (openrouterModel) return openrouterModel;
    }

    return null;
}

/**
 * Gets all models available for a provider, including inherited models
 * when supportsAllRegistryModels is true.
 * @param provider The name of the provider.
 * @returns Array of ModelInfo with additional originalProvider field for inherited models.
 */
export function getAllModelsForProvider(
    provider: LLMProvider
): Array<ModelInfo & { originalProvider?: LLMProvider }> {
    const providerInfo = LLM_REGISTRY[provider];

    // If provider doesn't support all registry models, return its own models
    if (!providerInfo.supportsAllRegistryModels) {
        return providerInfo.models.map((m) => ({ ...m }));
    }

    const allModels: Array<ModelInfo & { originalProvider?: LLMProvider }> = [];
    const seen = new Set<string>();

    for (const model of providerInfo.models) {
        const key = model.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        allModels.push({ ...model, originalProvider: provider });
    }

    // Gateway providers inherit the OpenRouter gateway catalog (OpenRouter-format IDs).
    // This keeps the "all models" list useful without requiring per-model OpenRouter ID mapping.
    if (provider !== 'openrouter') {
        for (const model of LLM_REGISTRY.openrouter.models) {
            const key = model.name.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            allModels.push({ ...model, originalProvider: 'openrouter' });
        }
    }

    return allModels;
}

/**
 * Transforms a model name to the format required by a gateway provider (dexto-nova/openrouter).
 * This is primarily used for internal wiring (e.g. sub-agent LLM resolution).
 *
 * Note: user-facing configs should prefer OpenRouter-format IDs directly when using gateway providers.
 *
 * Transformation is needed when:
 * - Target is a gateway (dexto-nova/openrouter)
 * - Original provider is a "native" provider (anthropic, openai, google, etc.)
 *
 * No transformation needed when:
 * - Target is not a gateway
 * - Original provider is already a gateway (dexto-nova/openrouter) - model is already in correct format
 * - Model already contains a slash (already in OpenRouter format)
 * - Provider models have vendor prefixes (groq's meta-llama/)
 *
 * @param model The model name to transform.
 * @param originalProvider The provider the model originally belongs to.
 * @param targetProvider The provider to transform the model name for.
 * @returns The transformed model name.
 */
export function transformModelNameForProvider(
    model: string,
    originalProvider: LLMProvider,
    targetProvider: LLMProvider
): string {
    // Only transform when targeting gateway providers (those with supportsAllRegistryModels)
    if (!hasAllRegistryModelsSupport(targetProvider)) {
        return model;
    }

    // If original provider is already a gateway, model is already in correct format
    if (hasAllRegistryModelsSupport(originalProvider)) {
        return model;
    }

    // If model already has a slash, assume it's already in OpenRouter format
    if (model.includes('/')) {
        return model;
    }

    const candidates = getOpenRouterCandidateModelIds(model, originalProvider);
    if (candidates.length === 0) return model;

    return pickExistingOpenRouterModelId(candidates) ?? candidates[0]!;
}

/**
 * Checks if a model is valid for a provider, considering supportsAllRegistryModels.
 * @param provider The provider to check.
 * @param model The model name to validate.
 * @returns True if the model is valid for the provider.
 */
export function isModelValidForProvider(provider: LLMProvider, model: string): boolean {
    const providerInfo = LLM_REGISTRY[provider];

    // Check provider's own models first
    const normalizedModel = getNormalizedModelIdForLookup(provider, model);
    if (providerInfo.models.some((m) => m.name.toLowerCase() === normalizedModel)) {
        return true;
    }

    // Gateway providers require OpenRouter-format IDs.
    if (providerInfo.supportsAllRegistryModels && !model.includes('/')) {
        return false;
    }

    // If provider supports custom models, any model is valid
    if (providerInfo.supportsCustomModels) {
        return true;
    }

    // If provider is a gateway (but doesn't allow arbitrary custom IDs), restrict to known OpenRouter catalog models.
    if (providerInfo.supportsAllRegistryModels) {
        return findModelInfo(provider, model) !== null;
    }

    return false;
}

/**
 * Providers that don't require API keys.
 * These include:
 * - Native local providers (local for node-llama-cpp, ollama for Ollama server)
 * - Local/self-hosted providers (openai-compatible for vLLM, LocalAI)
 * - Proxies that handle auth internally (litellm)
 * - Cloud auth providers (vertex uses ADC, bedrock uses AWS credentials)
 */
const API_KEY_OPTIONAL_PROVIDERS: Set<LLMProvider> = new Set([
    'local', // Native node-llama-cpp execution - no auth needed
    'ollama', // Ollama server - no auth needed by default
    'openai-compatible', // vLLM, LocalAI - often no auth needed
    'litellm', // Self-hosted proxy - handles auth internally
    'vertex', // Uses Google Cloud ADC (Application Default Credentials)
    'bedrock', // Uses AWS credentials (access key + secret or IAM role)
]);

/**
 * Checks if a provider requires an API key.
 * Returns false for:
 * - Local providers (openai-compatible for Ollama, vLLM, LocalAI)
 * - Self-hosted proxies (litellm)
 * - Cloud auth providers (vertex, bedrock)
 *
 * @param provider The name of the provider.
 * @returns True if the provider requires an API key, false otherwise.
 */
export function requiresApiKey(provider: LLMProvider): boolean {
    return !API_KEY_OPTIONAL_PROVIDERS.has(provider);
}

/**
 * Gets the supported file types for a specific model.
 * For gateway providers with supportsAllRegistryModels, looks up the model in its original provider.
 * @param provider The name of the provider.
 * @param model The name of the model.
 * @returns Array of supported file types for the model.
 * @throws {Error} If the model is not found in the registry.
 */
export function getSupportedFileTypesForModel(
    provider: LLMProvider,
    model: string
): SupportedFileType[] {
    const providerInfo = LLM_REGISTRY[provider];

    // For providers that accept any model name (openai-compatible, proxies), use provider-level defaults.
    if (acceptsAnyModel(provider)) {
        return providerInfo.supportedFileTypes;
    }

    const modelInfo = findModelInfo(provider, model);
    if (modelInfo) {
        return modelInfo.supportedFileTypes;
    }

    // For providers that allow arbitrary model IDs, fall back to provider-level defaults.
    if (supportsCustomModels(provider)) {
        return providerInfo.supportedFileTypes;
    }

    throw LLMError.unknownModel(provider, model);
}

/**
 * Checks if a specific model supports a specific file type.
 * @param provider The name of the provider.
 * @param model The name of the model.
 * @param fileType The file type to check support for.
 * @returns True if the model supports the file type, false otherwise.
 */
export function modelSupportsFileType(
    provider: LLMProvider,
    model: string,
    fileType: SupportedFileType
): boolean {
    const supportedTypes = getSupportedFileTypesForModel(provider, model);
    return supportedTypes.includes(fileType);
}

/**
 * Validates if file data is supported by a specific model by checking the mimetype
 * @param provider The LLM provider name.
 * @param model The model name.
 * @param mimeType The MIME type of the file to validate.
 * @returns Object containing validation result and details.
 */
export function validateModelFileSupport(
    provider: LLMProvider,
    model: string,
    mimeType: string
): {
    isSupported: boolean;
    fileType?: SupportedFileType;
    error?: string;
} {
    // Extract base MIME type by removing parameters (e.g., "audio/webm;codecs=opus" -> "audio/webm")
    const baseMimeType = mimeType.toLowerCase().split(';')[0]?.trim() || mimeType.toLowerCase();
    const fileType = MIME_TYPE_TO_FILE_TYPE[baseMimeType];
    if (!fileType) {
        return {
            isSupported: false,
            error: `Unsupported file type: ${mimeType}`,
        };
    }

    try {
        if (!modelSupportsFileType(provider, model, fileType)) {
            return {
                isSupported: false,
                fileType,
                error: `Model '${model}' (${provider}) does not support ${fileType} files`,
            };
        }

        return {
            isSupported: true,
            fileType,
        };
    } catch (error) {
        return {
            isSupported: false,
            fileType,
            error:
                error instanceof Error
                    ? error.message
                    : 'Unknown error validating model file support',
        };
    }
}

/**
 * Determines the effective maximum input token limit based on configuration.
 * Priority:
 * 1. Explicit `maxInputTokens` in config
 * 2. Registry lookup for known provider/model.
 *
 * @param config The validated LLM configuration.
 * @param logger Optional logger instance for logging.
 * @returns The effective maximum input token count for the LLM.
 *
 * Notes:
 * - If `baseURL` is set but `maxInputTokens` is missing, this logs a warning and falls back to
 *   `DEFAULT_MAX_INPUT_TOKENS`.
 * - If `baseURL` is not set and the model isn't found in the registry, this throws.
 * TODO: make more readable
 */
export function getEffectiveMaxInputTokens(config: LLMConfig, logger: Logger): number {
    const configuredMaxInputTokens = config.maxInputTokens;

    // Priority 1: Explicit config override or required value with baseURL
    if (configuredMaxInputTokens != null) {
        // Case 1a: baseURL is set. maxInputTokens is required and validated by Zod. Trust it.
        if (config.baseURL) {
            logger.debug(
                `Using maxInputTokens from configuration (with baseURL): ${configuredMaxInputTokens}`
            );
            return configuredMaxInputTokens;
        }

        // Case 1b: baseURL is NOT set, but maxInputTokens is provided (override).
        // Sanity-check against registry limits.
        try {
            const registryMaxInputTokens = getMaxInputTokensForModel(
                config.provider,
                config.model,
                logger
            );
            if (configuredMaxInputTokens > registryMaxInputTokens) {
                logger.warn(
                    `Provided maxInputTokens (${configuredMaxInputTokens}) for ${config.provider}/${config.model} exceeds the known limit (${registryMaxInputTokens}) for model ${config.model}. Capping to registry limit.`
                );
                return registryMaxInputTokens;
            } else {
                logger.debug(
                    `Using valid maxInputTokens override from configuration: ${configuredMaxInputTokens} (Registry limit: ${registryMaxInputTokens})`
                );
                return configuredMaxInputTokens;
            }
        } catch (error: unknown) {
            // Handle registry lookup failures during override check
            if (error instanceof DextoRuntimeError && error.code === LLMErrorCode.MODEL_UNKNOWN) {
                logger.warn(
                    `Registry lookup failed during maxInputTokens override check for ${config.provider}/${config.model}: ${error.message}. ` +
                        `Proceeding with the provided maxInputTokens value (${configuredMaxInputTokens}), but it might be invalid.`
                );
                // Return the user's value, assuming Zod validation passed for provider/model existence initially.
                return configuredMaxInputTokens;
            } else {
                // Re-throw unexpected errors
                const errorMessage = error instanceof Error ? error.message : String(error);
                logger.error(
                    `getEffectiveMaxInputTokens: unexpected error during maxInputTokens override check: ${errorMessage}`
                );
                throw error;
            }
        }
    }

    // Priority 2: baseURL is set but maxInputTokens is missing - default to 128k tokens
    if (config.baseURL) {
        logger.warn(
            `baseURL is set but maxInputTokens is missing. Defaulting to ${DEFAULT_MAX_INPUT_TOKENS}. ` +
                `Provide 'maxInputTokens' in configuration to avoid default fallback.`
        );
        return DEFAULT_MAX_INPUT_TOKENS;
    }

    // Priority 3: Check if provider accepts any model (like openai-compatible)
    if (acceptsAnyModel(config.provider)) {
        logger.debug(
            `Provider ${config.provider} accepts any model, defaulting to ${DEFAULT_MAX_INPUT_TOKENS} tokens`
        );
        return DEFAULT_MAX_INPUT_TOKENS;
    }

    // Priority 4: No override, no baseURL - use registry.
    try {
        const registryMaxInputTokens = getMaxInputTokensForModel(
            config.provider,
            config.model,
            logger
        );
        logger.debug(
            `Using maxInputTokens from registry for ${config.provider}/${config.model}: ${registryMaxInputTokens}`
        );
        return registryMaxInputTokens;
    } catch (error: unknown) {
        // Handle registry lookup failures gracefully (e.g., typo in validated config)
        if (error instanceof DextoRuntimeError && error.code === LLMErrorCode.MODEL_UNKNOWN) {
            // For providers that support custom models, use default instead of throwing
            if (supportsCustomModels(config.provider)) {
                logger.debug(
                    `Custom model ${config.model} not in ${config.provider} registry, defaulting to ${DEFAULT_MAX_INPUT_TOKENS} tokens`
                );
                return DEFAULT_MAX_INPUT_TOKENS;
            }
            // Log as error and throw a specific fatal error
            logger.error(
                `Registry lookup failed for ${config.provider}/${config.model}: ${error.message}. ` +
                    `Effective maxInputTokens cannot be determined.`
            );
            throw LLMError.unknownModel(config.provider, config.model);
        } else {
            // Re-throw unexpected errors during registry lookup
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(
                `getEffectiveMaxInputTokens: unexpected error during registry lookup for maxInputTokens: ${errorMessage}`
            );
            throw error;
        }
    }
}

/**
 * Gets the pricing information for a specific model.
 * For gateway providers with supportsAllRegistryModels, looks up the model in its original provider.
 *
 * Note: This returns the original provider's pricing. Gateway providers may have markup
 * that should be applied separately if needed.
 *
 * @param provider The name of the provider.
 * @param model The name of the model.
 * @returns The pricing information for the model, or undefined if not available.
 */
export function getModelPricing(provider: LLMProvider, model: string): ModelPricing | undefined {
    // For providers that accept any model name, pricing is unknown.
    if (acceptsAnyModel(provider)) {
        return undefined;
    }

    const modelInfo = findModelInfo(provider, model);
    return modelInfo?.pricing;
}

/**
 * Gets the display name for a model, falling back to the model ID if not found.
 */
export function getModelDisplayName(model: string, provider?: LLMProvider): string {
    if (provider) {
        const modelInfo = findModelInfo(provider, model);
        return modelInfo?.displayName ?? model;
    }

    // For OpenRouter-format IDs, try the OpenRouter catalog for a friendly name.
    if (model.includes('/')) {
        const modelInfo = findModelInfo('openrouter', model);
        return modelInfo?.displayName ?? model;
    }

    try {
        const inferredProvider = getProviderFromModel(model);
        const modelInfo = findModelInfo(inferredProvider, model);
        return modelInfo?.displayName ?? model;
    } catch {
        return model;
    }
}

// TODO: Add reasoningCapable as a property in the model registry instead of hardcoding here
/**
 * Checks if a model supports configurable reasoning effort.
 * Currently only OpenAI reasoning models (o1, o3, codex, gpt-5.x) support this.
 *
 * @param model The model name to check.
 * @param provider Optional provider for context (defaults to detecting from model name).
 * @returns True if the model supports reasoning effort configuration.
 */
export function isReasoningCapableModel(model: string, _provider?: LLMProvider): boolean {
    const modelLower = model.toLowerCase();

    // Codex models are optimized for complex coding with reasoning
    if (modelLower.includes('codex')) {
        return true;
    }

    // o1 and o3 are dedicated reasoning models
    if (modelLower.startsWith('o1') || modelLower.startsWith('o3') || modelLower.startsWith('o4')) {
        return true;
    }

    // GPT-5 series support reasoning effort
    if (
        modelLower.includes('gpt-5') ||
        modelLower.includes('gpt-5.1') ||
        modelLower.includes('gpt-5.2')
    ) {
        return true;
    }

    return false;
}

/**
 * Calculates the cost for a given token usage based on model pricing.
 *
 * @param usage Token usage counts.
 * @param pricing Model pricing (per million tokens).
 * @returns Cost in USD.
 */
export function calculateCost(usage: TokenUsage, pricing: ModelPricing): number {
    const inputCost = ((usage.inputTokens ?? 0) * pricing.inputPerM) / 1_000_000;
    const outputCost = ((usage.outputTokens ?? 0) * pricing.outputPerM) / 1_000_000;
    const cacheReadCost = ((usage.cacheReadTokens ?? 0) * (pricing.cacheReadPerM ?? 0)) / 1_000_000;
    const cacheWriteCost =
        ((usage.cacheWriteTokens ?? 0) * (pricing.cacheWritePerM ?? 0)) / 1_000_000;
    // Charge reasoning tokens at output rate
    const reasoningCost = ((usage.reasoningTokens ?? 0) * pricing.outputPerM) / 1_000_000;

    return inputCost + outputCost + cacheReadCost + cacheWriteCost + reasoningCost;
}
