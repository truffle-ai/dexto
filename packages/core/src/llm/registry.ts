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

import { LLMConfig } from './schemas.js';
import { LLMError } from './errors.js';
import { LLMErrorCode } from './error-codes.js';
import { DextoRuntimeError } from '../errors/DextoRuntimeError.js';
import { ErrorScope, ErrorType } from '../errors/types.js';
import {
    LLM_PROVIDERS,
    type LLMProvider,
    type SupportedFileType,
    type TokenUsage,
} from './types.js';
import type { IDextoLogger } from '../logger/v2/types.js';
import { getOpenRouterModelContextLength } from './providers/openrouter-model-registry.js';

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
    /**
     * OpenRouter model ID for use with gateway providers (dexto, openrouter).
     * Only needed when the OpenRouter ID differs from the native model ID.
     * For most OpenAI/Google/xAI models, the ID is just `{provider}/{name}`.
     * For Anthropic, the IDs differ significantly (e.g., `claude-haiku-4-5-20251001` → `anthropic/claude-haiku-4.5`).
     */
    openrouterId?: string;
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
     * Used for gateway providers like 'dexto' that route to multiple upstream providers.
     * Model names are transformed to the gateway's format (e.g., 'gpt-5-mini' → 'openai/gpt-5-mini').
     */
    supportsAllRegistryModels?: boolean;
    /**
     * OpenRouter prefix for this provider's models (e.g., 'openai', 'anthropic', 'x-ai').
     * Used by gateway providers to parse and route prefixed model names.
     * - If set: provider's models can be accessed via gateway as `{prefix}/{model}`
     * - If undefined: provider is not accessible via gateways (local, gateway providers themselves)
     */
    openrouterPrefix?: string;
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
        models: [
            // GPT-5.2 series (latest, released Dec 2025)
            {
                name: 'gpt-5.2-chat-latest',
                displayName: 'GPT-5.2 Instant',
                openrouterId: 'openai/gpt-5.2-chat',
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
                name: 'gpt-5.2',
                displayName: 'GPT-5.2 Thinking',
                openrouterId: 'openai/gpt-5.2',
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
                name: 'gpt-5.2-pro',
                displayName: 'GPT-5.2 Pro',
                openrouterId: 'openai/gpt-5.2-pro',
                maxInputTokens: 400000,
                supportedFileTypes: ['pdf', 'image'],
                pricing: {
                    inputPerM: 21.0,
                    outputPerM: 168.0,
                    cacheReadPerM: 2.1,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'gpt-5.2-codex',
                displayName: 'GPT-5.2 Codex',
                openrouterId: 'openai/gpt-5.2-codex',
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
            // GPT-5.1 series
            {
                name: 'gpt-5.1-chat-latest',
                displayName: 'GPT-5.1 Instant',
                openrouterId: 'openai/gpt-5.1-chat',
                maxInputTokens: 400000,
                supportedFileTypes: ['pdf', 'image'],
                pricing: {
                    inputPerM: 1.25,
                    outputPerM: 10.0,
                    cacheReadPerM: 0.125,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'gpt-5.1',
                displayName: 'GPT-5.1 Thinking',
                openrouterId: 'openai/gpt-5.1',
                maxInputTokens: 400000,
                supportedFileTypes: ['pdf', 'image'],
                pricing: {
                    inputPerM: 1.25,
                    outputPerM: 10.0,
                    cacheReadPerM: 0.125,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'gpt-5.1-codex',
                displayName: 'GPT-5.1 Codex',
                openrouterId: 'openai/gpt-5.1-codex',
                maxInputTokens: 400000,
                supportedFileTypes: ['pdf', 'image'],
                pricing: {
                    inputPerM: 1.25,
                    outputPerM: 10.0,
                    cacheReadPerM: 0.125,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'gpt-5.1-codex-mini',
                displayName: 'GPT-5.1 Codex Mini',
                openrouterId: 'openai/gpt-5.1-codex-mini',
                maxInputTokens: 400000,
                supportedFileTypes: ['pdf', 'image'],
                pricing: {
                    inputPerM: 0.25,
                    outputPerM: 2.0,
                    cacheReadPerM: 0.025,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            // {
            //     name: 'gpt-5.1-codex-max',
            //     displayName: 'GPT-5.1 Codex Max',
            //     maxInputTokens: 400000,
            //     supportedFileTypes: ['pdf', 'image'],
            //     pricing: {
            //         inputPerM: 1.25,
            //         outputPerM: 10.0,
            //         cacheReadPerM: 0.125,
            //         currency: 'USD',
            //         unit: 'per_million_tokens',
            //     },
            // },
            {
                name: 'gpt-5-pro',
                displayName: 'GPT-5 Pro',
                openrouterId: 'openai/gpt-5-pro',
                maxInputTokens: 400000,
                supportedFileTypes: ['pdf', 'image'],
                pricing: {
                    inputPerM: 15.0,
                    outputPerM: 120.0,
                    cacheReadPerM: 1.5,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'gpt-5',
                displayName: 'GPT-5',
                openrouterId: 'openai/gpt-5',
                maxInputTokens: 400000,
                supportedFileTypes: ['pdf', 'image'],
                pricing: {
                    inputPerM: 1.25,
                    outputPerM: 10.0,
                    cacheReadPerM: 0.125,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'gpt-5-mini',
                displayName: 'GPT-5 Mini',
                openrouterId: 'openai/gpt-5-mini',
                maxInputTokens: 400000,
                default: true,
                supportedFileTypes: ['pdf', 'image'],
                pricing: {
                    inputPerM: 0.25,
                    outputPerM: 2.0,
                    cacheReadPerM: 0.025,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'gpt-5-nano',
                displayName: 'GPT-5 Nano',
                openrouterId: 'openai/gpt-5-nano',
                maxInputTokens: 400000,
                supportedFileTypes: ['pdf', 'image'],
                pricing: {
                    inputPerM: 0.05,
                    outputPerM: 0.4,
                    cacheReadPerM: 0.005,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'gpt-5-codex',
                displayName: 'GPT-5 Codex',
                openrouterId: 'openai/gpt-5-codex',
                maxInputTokens: 400000,
                supportedFileTypes: ['pdf', 'image'],
                pricing: {
                    inputPerM: 1.25,
                    outputPerM: 10.0,
                    cacheReadPerM: 0.125,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'gpt-4.1',
                displayName: 'GPT-4.1',
                openrouterId: 'openai/gpt-4.1',
                maxInputTokens: 1048576,
                supportedFileTypes: ['pdf', 'image'],
                pricing: {
                    inputPerM: 2.0,
                    outputPerM: 8.0,
                    cacheReadPerM: 0.5,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'gpt-4.1-mini',
                displayName: 'GPT-4.1 Mini',
                openrouterId: 'openai/gpt-4.1-mini',
                maxInputTokens: 1048576,
                supportedFileTypes: ['pdf', 'image'],
                pricing: {
                    inputPerM: 0.4,
                    outputPerM: 1.6,
                    cacheReadPerM: 0.1,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'gpt-4.1-nano',
                displayName: 'GPT-4.1 Nano',
                openrouterId: 'openai/gpt-4.1-nano',
                maxInputTokens: 1048576,
                supportedFileTypes: ['pdf', 'image'],
                pricing: {
                    inputPerM: 0.1,
                    outputPerM: 0.4,
                    cacheReadPerM: 0.025,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'gpt-4o',
                displayName: 'GPT-4o',
                openrouterId: 'openai/gpt-4o',
                maxInputTokens: 128000,
                supportedFileTypes: ['pdf', 'image'],
                pricing: {
                    inputPerM: 2.5,
                    outputPerM: 10.0,
                    cacheReadPerM: 1.25,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'gpt-4o-mini',
                displayName: 'GPT-4o Mini',
                openrouterId: 'openai/gpt-4o-mini',
                maxInputTokens: 128000,
                supportedFileTypes: ['pdf', 'image'],
                pricing: {
                    inputPerM: 0.15,
                    outputPerM: 0.6,
                    cacheReadPerM: 0.075,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'gpt-4o-audio-preview',
                displayName: 'GPT-4o Audio Preview',
                openrouterId: 'openai/gpt-4o-audio-preview',
                maxInputTokens: 128000,
                supportedFileTypes: ['audio'],
                pricing: {
                    inputPerM: 2.5,
                    outputPerM: 10.0,
                    cacheReadPerM: 1.25,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'o4-mini',
                displayName: 'O4 Mini',
                openrouterId: 'openai/o4-mini',
                maxInputTokens: 200000,
                supportedFileTypes: ['pdf', 'image'],
                pricing: {
                    inputPerM: 1.1,
                    outputPerM: 4.4,
                    cacheReadPerM: 0.275,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'o3',
                displayName: 'O3',
                openrouterId: 'openai/o3',
                maxInputTokens: 200000,
                supportedFileTypes: ['pdf', 'image'],
                pricing: {
                    inputPerM: 2.0,
                    outputPerM: 8.0,
                    cacheReadPerM: 0.5,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'o3-mini',
                displayName: 'O3 Mini',
                openrouterId: 'openai/o3-mini',
                maxInputTokens: 200000,
                supportedFileTypes: [],
                pricing: {
                    inputPerM: 1.1,
                    outputPerM: 4.4,
                    cacheReadPerM: 0.55,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'o1',
                displayName: 'O1',
                openrouterId: 'openai/o1',
                maxInputTokens: 200000,
                supportedFileTypes: ['pdf', 'image'],
                pricing: {
                    inputPerM: 15.0,
                    outputPerM: 60.0,
                    cacheReadPerM: 7.5,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
        ],
        baseURLSupport: 'none',
        supportedFileTypes: [], // No defaults - models must explicitly specify support
        openrouterPrefix: 'openai',
    },
    'openai-compatible': {
        models: [], // Empty - accepts any model name for custom endpoints
        baseURLSupport: 'required',
        supportedFileTypes: ['pdf', 'image', 'audio'], // Allow all types for custom endpoints - user assumes responsibility for model capabilities
        supportsCustomModels: true,
    },
    anthropic: {
        models: [
            {
                name: 'claude-haiku-4-5-20251001',
                displayName: 'Claude 4.5 Haiku',
                openrouterId: 'anthropic/claude-haiku-4.5',
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
                name: 'claude-sonnet-4-5-20250929',
                displayName: 'Claude 4.5 Sonnet',
                openrouterId: 'anthropic/claude-sonnet-4.5',
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
                name: 'claude-opus-4-5-20251101',
                displayName: 'Claude 4.5 Opus',
                openrouterId: 'anthropic/claude-opus-4.5',
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
            {
                name: 'claude-opus-4-1-20250805',
                displayName: 'Claude 4.1 Opus',
                openrouterId: 'anthropic/claude-opus-4.1',
                maxInputTokens: 200000,
                supportedFileTypes: ['pdf', 'image'],
                pricing: {
                    inputPerM: 15.0,
                    outputPerM: 75.0,
                    cacheWritePerM: 18.75,
                    cacheReadPerM: 1.5,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'claude-4-opus-20250514',
                displayName: 'Claude 4 Opus',
                openrouterId: 'anthropic/claude-opus-4',
                maxInputTokens: 200000,
                supportedFileTypes: ['pdf', 'image'],
                pricing: {
                    inputPerM: 15.0,
                    outputPerM: 75.0,
                    cacheWritePerM: 18.75,
                    cacheReadPerM: 1.5,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'claude-4-sonnet-20250514',
                displayName: 'Claude 4 Sonnet',
                openrouterId: 'anthropic/claude-sonnet-4',
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
                name: 'claude-3-7-sonnet-20250219',
                displayName: 'Claude 3.7 Sonnet',
                openrouterId: 'anthropic/claude-3.7-sonnet',
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
                name: 'claude-3-5-sonnet-20240620',
                displayName: 'Claude 3.5 Sonnet',
                openrouterId: 'anthropic/claude-3.5-sonnet',
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
                name: 'claude-3-5-haiku-20241022',
                displayName: 'Claude 3.5 Haiku',
                openrouterId: 'anthropic/claude-3.5-haiku',
                maxInputTokens: 200000,
                supportedFileTypes: ['pdf', 'image'],
                pricing: {
                    inputPerM: 0.8,
                    outputPerM: 4,
                    cacheWritePerM: 1,
                    cacheReadPerM: 0.08,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
        ],
        baseURLSupport: 'none',
        supportedFileTypes: [], // No defaults - models must explicitly specify support
        openrouterPrefix: 'anthropic',
    },
    google: {
        models: [
            {
                name: 'gemini-3-flash-preview',
                displayName: 'Gemini 3 Flash Preview',
                openrouterId: 'google/gemini-3-flash-preview',
                maxInputTokens: 1048576,
                default: true,
                supportedFileTypes: ['pdf', 'image', 'audio'],
                pricing: {
                    inputPerM: 0.5,
                    outputPerM: 3.0,
                    cacheReadPerM: 0.05,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'gemini-3-pro-preview',
                displayName: 'Gemini 3 Pro Preview',
                openrouterId: 'google/gemini-3-pro-preview',
                maxInputTokens: 1048576,
                supportedFileTypes: ['pdf', 'image', 'audio'],
                pricing: {
                    inputPerM: 2.0,
                    outputPerM: 12.0,
                    cacheReadPerM: 0.2,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'gemini-3-pro-image-preview',
                displayName: 'Gemini 3 Pro Image Preview',
                openrouterId: 'google/gemini-3-pro-image-preview',
                maxInputTokens: 1048576,
                supportedFileTypes: ['image'],
                pricing: {
                    inputPerM: 2.0,
                    outputPerM: 120.0,
                    cacheReadPerM: 0.2,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'gemini-2.5-pro',
                displayName: 'Gemini 2.5 Pro',
                openrouterId: 'google/gemini-2.5-pro',
                maxInputTokens: 1048576,
                supportedFileTypes: ['pdf', 'image', 'audio'],
                pricing: {
                    inputPerM: 1.25,
                    outputPerM: 10.0,
                    cacheReadPerM: 0.31,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'gemini-2.5-flash',
                displayName: 'Gemini 2.5 Flash',
                openrouterId: 'google/gemini-2.5-flash',
                maxInputTokens: 1048576,
                supportedFileTypes: ['pdf', 'image', 'audio'],
                pricing: {
                    inputPerM: 0.3,
                    outputPerM: 2.5,
                    cacheReadPerM: 0.03,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'gemini-2.5-flash-lite',
                displayName: 'Gemini 2.5 Flash Lite',
                openrouterId: 'google/gemini-2.5-flash-lite',
                maxInputTokens: 1048576,
                supportedFileTypes: ['pdf', 'image', 'audio'],
                pricing: {
                    inputPerM: 0.1,
                    outputPerM: 0.4,
                    cacheReadPerM: 0.025,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'gemini-2.0-flash',
                displayName: 'Gemini 2.0 Flash',
                openrouterId: 'google/gemini-2.0-flash-001',
                maxInputTokens: 1048576,
                supportedFileTypes: ['pdf', 'image', 'audio'],
                pricing: {
                    inputPerM: 0.15,
                    outputPerM: 0.6,
                    cacheReadPerM: 0.025,
                    cacheWritePerM: 1.0,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'gemini-2.0-flash-lite',
                displayName: 'Gemini 2.0 Flash Lite',
                openrouterId: 'google/gemini-2.0-flash-lite-001',
                maxInputTokens: 1048576,
                supportedFileTypes: ['pdf', 'image', 'audio'],
                pricing: {
                    inputPerM: 0.075,
                    outputPerM: 0.3,
                    cacheReadPerM: 0.01875,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
        ],
        baseURLSupport: 'none',
        supportedFileTypes: [], // No defaults - models must explicitly specify support
        openrouterPrefix: 'google',
    },
    // https://console.groq.com/docs/models
    groq: {
        models: [
            {
                name: 'gemma-2-9b-it',
                displayName: 'Gemma 2 9B Instruct',
                maxInputTokens: 8192,
                supportedFileTypes: [],
                pricing: {
                    inputPerM: 0.2,
                    outputPerM: 0.2,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'openai/gpt-oss-20b',
                displayName: 'GPT OSS 20B 128k',
                maxInputTokens: 128000,
                supportedFileTypes: [],
                pricing: {
                    inputPerM: 0.1,
                    outputPerM: 0.5,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'openai/gpt-oss-120b',
                displayName: 'GPT OSS 120B 128k',
                maxInputTokens: 128000,
                supportedFileTypes: [],
                pricing: {
                    inputPerM: 0.15,
                    outputPerM: 0.75,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'moonshotai/kimi-k2-instruct',
                displayName: 'Kimi K2 1T 128k',
                maxInputTokens: 128000,
                supportedFileTypes: [],
                pricing: {
                    inputPerM: 1.0,
                    outputPerM: 3.0,
                    cacheReadPerM: 0.5,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'meta-llama/llama-4-scout-17b-16e-instruct',
                displayName: 'Llama 4 Scout (17Bx16E) 128k',
                maxInputTokens: 128000,
                supportedFileTypes: [],
                pricing: {
                    inputPerM: 0.11,
                    outputPerM: 0.34,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'meta-llama/llama-4-maverick-17b-128e-instruct',
                displayName: 'Llama 4 Maverick (17Bx128E) 128k',
                maxInputTokens: 128000,
                supportedFileTypes: [],
                pricing: {
                    inputPerM: 0.2,
                    outputPerM: 0.6,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'deepseek-r1-distill-llama-70b',
                displayName: 'DeepSeek R1 Distill Llama 70B 128k',
                maxInputTokens: 128000,
                supportedFileTypes: [],
                pricing: {
                    inputPerM: 0.75,
                    outputPerM: 0.9,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'qwen/qwen3-32b',
                displayName: 'Qwen3 32B 131k',
                maxInputTokens: 131000,
                supportedFileTypes: [],
                pricing: {
                    inputPerM: 0.29,
                    outputPerM: 0.59,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'llama-3.3-70b-versatile',
                displayName: 'Llama 3.3 70B Versatile',
                maxInputTokens: 128000,
                default: true,
                supportedFileTypes: [],
                pricing: {
                    inputPerM: 0.59,
                    outputPerM: 0.79,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
        ],
        baseURLSupport: 'none',
        supportedFileTypes: [], // Groq currently doesn't support file uploads
    },
    // https://docs.x.ai/docs/models
    // Note: XAI API only supports image uploads (JPG/PNG up to 20MB), not PDFs
    xai: {
        models: [
            {
                name: 'grok-4',
                displayName: 'Grok 4',
                openrouterId: 'x-ai/grok-4',
                maxInputTokens: 256000,
                default: true,
                supportedFileTypes: ['image'],
                pricing: {
                    inputPerM: 3.0,
                    outputPerM: 15.0,
                    cacheReadPerM: 0.75,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'grok-3',
                displayName: 'Grok 3',
                openrouterId: 'x-ai/grok-3',
                maxInputTokens: 131072,
                supportedFileTypes: ['image'],
                pricing: {
                    inputPerM: 3.0,
                    outputPerM: 15.0,
                    cacheReadPerM: 0.75,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'grok-3-mini',
                displayName: 'Grok 3 Mini',
                openrouterId: 'x-ai/grok-3-mini',
                maxInputTokens: 131072,
                supportedFileTypes: ['image'],
                pricing: {
                    inputPerM: 0.3,
                    outputPerM: 0.5,
                    cacheReadPerM: 0.075,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'grok-code-fast-1',
                displayName: 'Grok Code Fast',
                openrouterId: 'x-ai/grok-code-fast-1',
                maxInputTokens: 131072,
                supportedFileTypes: [],
                pricing: {
                    inputPerM: 0.2,
                    outputPerM: 1.5,
                    cacheReadPerM: 0.02,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
        ],
        baseURLSupport: 'none',
        supportedFileTypes: [], // XAI currently doesn't support file uploads
        openrouterPrefix: 'x-ai',
    },
    // https://docs.cohere.com/reference/models
    cohere: {
        models: [
            {
                name: 'command-a-03-2025',
                displayName: 'Command A (03-2025)',
                openrouterId: 'cohere/command-a',
                maxInputTokens: 256000,
                default: true,
                supportedFileTypes: [],
                pricing: {
                    inputPerM: 2.5,
                    outputPerM: 10.0,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'command-r-plus',
                displayName: 'Command R+',
                openrouterId: 'cohere/command-r-plus-08-2024',
                maxInputTokens: 128000,
                supportedFileTypes: [],
                pricing: {
                    inputPerM: 2.5,
                    outputPerM: 10.0,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'command-r',
                displayName: 'Command R',
                openrouterId: 'cohere/command-r-08-2024',
                maxInputTokens: 128000,
                supportedFileTypes: [],
                pricing: {
                    inputPerM: 0.15,
                    outputPerM: 0.6,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'command-r7b',
                displayName: 'Command R7B',
                openrouterId: 'cohere/command-r7b-12-2024',
                maxInputTokens: 128000,
                supportedFileTypes: [],
                pricing: {
                    inputPerM: 0.0375,
                    outputPerM: 0.15,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
        ],
        baseURLSupport: 'none',
        supportedFileTypes: [], // Cohere currently doesn't support file uploads
        openrouterPrefix: 'cohere',
    },
    // https://openrouter.ai/docs
    // OpenRouter is a unified API gateway providing access to 100+ models from various providers.
    // Model validation is handled dynamically via openrouter-model-registry.ts
    openrouter: {
        models: [], // Empty - accepts any model name (validated against OpenRouter's catalog)
        baseURLSupport: 'none', // Fixed endpoint - baseURL auto-injected in resolver, no user override allowed
        supportedFileTypes: ['pdf', 'image', 'audio'], // Allow all types - user assumes responsibility for model capabilities
        supportsCustomModels: true,
        supportsAllRegistryModels: true, // Can serve models from all other providers
    },
    // https://docs.litellm.ai/
    // LiteLLM is an OpenAI-compatible proxy that unifies 100+ LLM providers.
    // User must host their own LiteLLM proxy and provide the baseURL.
    litellm: {
        models: [], // Empty - accepts any model name (user's proxy determines available models)
        baseURLSupport: 'required', // User must provide their LiteLLM proxy URL
        supportedFileTypes: ['pdf', 'image', 'audio'], // Allow all types - user assumes responsibility for model capabilities
        supportsCustomModels: true,
    },
    // https://glama.ai/
    // Glama is an OpenAI-compatible gateway providing unified access to multiple LLM providers.
    // Fixed endpoint: https://glama.ai/api/gateway/openai/v1
    glama: {
        models: [], // Empty - accepts any model name (format: provider/model e.g., openai/gpt-4o)
        baseURLSupport: 'none', // Fixed endpoint - baseURL auto-injected
        supportedFileTypes: ['pdf', 'image', 'audio'], // Allow all types - user assumes responsibility for model capabilities
        supportsCustomModels: true,
    },
    // https://cloud.google.com/vertex-ai
    // Google Vertex AI - GCP-hosted gateway for Gemini and Claude models
    // Supports both Google's Gemini models and Anthropic's Claude via partnership
    //
    // Setup instructions:
    // 1. Create a Google Cloud account and project
    // 2. Enable the Vertex AI API: gcloud services enable aiplatform.googleapis.com
    // 3. Enable desired Claude models (requires Anthropic Model Garden)
    // 4. Install Google Cloud CLI: https://cloud.google.com/sdk/docs/install
    // 5. Configure ADC: gcloud auth application-default login
    // 6. Set env vars: GOOGLE_VERTEX_PROJECT (required), GOOGLE_VERTEX_LOCATION (optional)
    //
    // TODO: Add dynamic model fetching via publishers.models.list API
    // - Requires: projectId, region, ADC auth
    // - Endpoints: GET projects/{project}/locations/{location}/publishers/{google,anthropic}/models
    // - Note: API doesn't return aliases (e.g., gemini-2.0-flash), only versioned IDs
    // - Docs: https://cloud.google.com/vertex-ai/docs/reference/rest/v1/projects.locations.models/list
    // - Models: https://cloud.google.com/vertex-ai/generative-ai/docs/models
    vertex: {
        models: [
            // Gemini 3 models on Vertex AI (Preview)
            {
                name: 'gemini-3-flash-preview',
                displayName: 'Gemini 3 Flash (Vertex)',
                maxInputTokens: 1048576,
                default: true,
                supportedFileTypes: ['pdf', 'image', 'audio'],
                pricing: {
                    inputPerM: 0.5,
                    outputPerM: 3.0,
                    cacheReadPerM: 0.05,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'gemini-3-pro-preview',
                displayName: 'Gemini 3 Pro (Vertex)',
                maxInputTokens: 1048576,
                supportedFileTypes: ['pdf', 'image', 'audio'],
                pricing: {
                    inputPerM: 2.0,
                    outputPerM: 12.0,
                    cacheReadPerM: 0.2,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            // Gemini 2.x models on Vertex AI
            {
                name: 'gemini-2.5-pro',
                displayName: 'Gemini 2.5 Pro (Vertex)',
                maxInputTokens: 1048576,
                supportedFileTypes: ['pdf', 'image', 'audio'],
                pricing: {
                    inputPerM: 1.25,
                    outputPerM: 10.0,
                    cacheReadPerM: 0.31,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'gemini-2.5-flash',
                displayName: 'Gemini 2.5 Flash (Vertex)',
                maxInputTokens: 1048576,
                supportedFileTypes: ['pdf', 'image', 'audio'],
                pricing: {
                    inputPerM: 0.15,
                    outputPerM: 0.6,
                    cacheReadPerM: 0.0375,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'gemini-2.0-flash',
                displayName: 'Gemini 2.0 Flash (Vertex)',
                maxInputTokens: 1048576,
                supportedFileTypes: ['pdf', 'image', 'audio'],
                pricing: {
                    inputPerM: 0.1,
                    outputPerM: 0.4,
                    cacheReadPerM: 0.025,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            // Claude 4.5 models on Vertex AI (via Anthropic partnership)
            // Note: Claude model IDs use @ suffix format on Vertex
            {
                name: 'claude-opus-4-5@20251101',
                displayName: 'Claude 4.5 Opus (Vertex)',
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
            {
                name: 'claude-sonnet-4-5@20250929',
                displayName: 'Claude 4.5 Sonnet (Vertex)',
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
                name: 'claude-haiku-4-5@20251001',
                displayName: 'Claude 4.5 Haiku (Vertex)',
                maxInputTokens: 200000,
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
            // Claude 4.1 and 4.0 models on Vertex AI
            {
                name: 'claude-opus-4-1@20250805',
                displayName: 'Claude 4.1 Opus (Vertex)',
                maxInputTokens: 200000,
                supportedFileTypes: ['pdf', 'image'],
                pricing: {
                    inputPerM: 15.0,
                    outputPerM: 75.0,
                    cacheWritePerM: 18.75,
                    cacheReadPerM: 1.5,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'claude-opus-4@20250514',
                displayName: 'Claude 4 Opus (Vertex)',
                maxInputTokens: 200000,
                supportedFileTypes: ['pdf', 'image'],
                pricing: {
                    inputPerM: 15.0,
                    outputPerM: 75.0,
                    cacheWritePerM: 18.75,
                    cacheReadPerM: 1.5,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'claude-sonnet-4@20250514',
                displayName: 'Claude 4 Sonnet (Vertex)',
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
            // Claude 3.x models on Vertex AI
            {
                name: 'claude-3-7-sonnet@20250219',
                displayName: 'Claude 3.7 Sonnet (Vertex)',
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
                name: 'claude-3-5-sonnet-v2@20241022',
                displayName: 'Claude 3.5 Sonnet v2 (Vertex)',
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
                name: 'claude-3-5-haiku@20241022',
                displayName: 'Claude 3.5 Haiku (Vertex)',
                maxInputTokens: 200000,
                supportedFileTypes: ['pdf', 'image'],
                pricing: {
                    inputPerM: 0.8,
                    outputPerM: 4.0,
                    cacheWritePerM: 1.0,
                    cacheReadPerM: 0.08,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
        ],
        baseURLSupport: 'none', // Auto-constructed from projectId and region
        supportedFileTypes: ['pdf', 'image', 'audio'],
    },
    // Amazon Bedrock - AWS-hosted gateway for Claude, Nova, and more
    // Auth: AWS credentials (env vars) or Bedrock API key (AWS_BEARER_TOKEN_BEDROCK)
    //
    // Cross-region inference: Auto-added for anthropic.* and amazon.* models
    // supportsCustomModels: true allows users to add custom model IDs beyond the fixed list
    bedrock: {
        supportsCustomModels: true,
        models: [
            // Claude 4.5 models (latest)
            {
                name: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
                displayName: 'Claude 4.5 Sonnet',
                maxInputTokens: 200000,
                default: true,
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
                name: 'anthropic.claude-haiku-4-5-20251001-v1:0',
                displayName: 'Claude 4.5 Haiku',
                maxInputTokens: 200000,
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
                name: 'anthropic.claude-opus-4-5-20251101-v1:0',
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
            // Amazon Nova models
            {
                name: 'amazon.nova-premier-v1:0',
                displayName: 'Nova Premier',
                maxInputTokens: 1000000,
                supportedFileTypes: ['image'],
                pricing: {
                    inputPerM: 2.5,
                    outputPerM: 12.5,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'amazon.nova-pro-v1:0',
                displayName: 'Nova Pro',
                maxInputTokens: 300000,
                supportedFileTypes: ['pdf', 'image'],
                pricing: {
                    inputPerM: 0.8,
                    outputPerM: 3.2,
                    cacheReadPerM: 0.2,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'amazon.nova-lite-v1:0',
                displayName: 'Nova Lite',
                maxInputTokens: 300000,
                supportedFileTypes: ['pdf', 'image'],
                pricing: {
                    inputPerM: 0.06,
                    outputPerM: 0.24,
                    cacheReadPerM: 0.015,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'amazon.nova-micro-v1:0',
                displayName: 'Nova Micro',
                maxInputTokens: 128000,
                supportedFileTypes: [],
                pricing: {
                    inputPerM: 0.035,
                    outputPerM: 0.14,
                    cacheReadPerM: 0.00875,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            // OpenAI GPT-OSS
            {
                name: 'openai.gpt-oss-120b-1:0',
                displayName: 'GPT-OSS 120B',
                maxInputTokens: 128000,
                supportedFileTypes: [],
                pricing: {
                    inputPerM: 0.15,
                    outputPerM: 0.6,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'openai.gpt-oss-20b-1:0',
                displayName: 'GPT-OSS 20B',
                maxInputTokens: 128000,
                supportedFileTypes: [],
                pricing: {
                    inputPerM: 0.07,
                    outputPerM: 0.3,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            // Qwen
            {
                name: 'qwen.qwen3-coder-30b-a3b-v1:0',
                displayName: 'Qwen3 Coder 30B',
                maxInputTokens: 262144,
                supportedFileTypes: [],
                pricing: {
                    inputPerM: 0.15,
                    outputPerM: 0.6,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'qwen.qwen3-coder-480b-a35b-v1:0',
                displayName: 'Qwen3 Coder 480B',
                maxInputTokens: 262144,
                supportedFileTypes: [],
                pricing: {
                    inputPerM: 0.22,
                    outputPerM: 1.8,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
        ],
        baseURLSupport: 'none', // Auto-constructed from region
        supportedFileTypes: ['pdf', 'image'],
    },
    // Native local model execution via node-llama-cpp
    // Runs GGUF models directly on the machine using Metal/CUDA/Vulkan acceleration
    // Models are downloaded from HuggingFace and stored in ~/.dexto/models/
    local: {
        models: [], // Populated dynamically from local model registry
        baseURLSupport: 'none', // No external server needed
        supportedFileTypes: ['image'], // Vision support depends on model capabilities
        supportsCustomModels: true, // Allow any GGUF model path
    },
    // Ollama server integration
    // Uses Ollama's OpenAI-compatible API for local model inference
    // Requires Ollama to be installed and running (default: http://localhost:11434)
    ollama: {
        models: [], // Populated dynamically from Ollama API
        baseURLSupport: 'optional', // Default: http://localhost:11434, can be customized
        supportedFileTypes: ['image'], // Vision support depends on model
        supportsCustomModels: true, // Accept any Ollama model name
    },
    // Dexto Gateway - OpenAI-compatible proxy through api.dexto.ai
    // Routes to OpenRouter with per-request billing (balance decrement)
    // Requires DEXTO_API_KEY from `dexto login`
    //
    // This is a first-class provider that users explicitly select.
    // Model IDs are in OpenRouter format (e.g., 'anthropic/claude-sonnet-4.5')
    dexto: {
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
                pricing: {
                    inputPerM: 2.0,
                    outputPerM: 12.0,
                    cacheReadPerM: 0.2,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            {
                name: 'google/gemini-3-flash-preview',
                displayName: 'Gemini 3 Flash',
                maxInputTokens: 1048576,
                supportedFileTypes: ['pdf', 'image', 'audio'],
                pricing: {
                    inputPerM: 0.5,
                    outputPerM: 3.0,
                    cacheReadPerM: 0.05,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
            // Free models (via OpenRouter)
            {
                name: 'qwen/qwen3-coder:free',
                displayName: 'Qwen3 Coder (Free)',
                maxInputTokens: 262000,
                supportedFileTypes: [],
                // Free - no pricing
            },
            {
                name: 'deepseek/deepseek-r1-0528:free',
                displayName: 'DeepSeek R1 (Free)',
                maxInputTokens: 163840,
                supportedFileTypes: [],
                // Free - no pricing
            },
            // Other models (via OpenRouter)
            {
                name: 'z-ai/glm-4.7',
                displayName: 'GLM 4.7',
                maxInputTokens: 202752,
                supportedFileTypes: [],
                pricing: {
                    inputPerM: 0.4,
                    outputPerM: 1.5,
                    currency: 'USD',
                    unit: 'per_million_tokens',
                },
            },
        ],
        baseURLSupport: 'none', // Fixed endpoint: https://api.dexto.ai/v1
        supportedFileTypes: ['pdf', 'image', 'audio'], // Same as OpenRouter
        supportsCustomModels: true, // Accept any OpenRouter model ID beyond the preset list
        supportsAllRegistryModels: true, // Can serve models from all other providers via OpenRouter
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
    return providerInfo.models.find((m) => m.default)?.name || null;
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
    logger?: IDextoLogger
): number {
    // Resolve gateway providers to the original provider
    const resolved = resolveToNativeProvider(provider, model);
    const providerInfo = LLM_REGISTRY[resolved.provider];

    const normalizedModel = stripBedrockRegionPrefix(resolved.model).toLowerCase();
    const modelInfo = providerInfo.models.find((m) => m.name.toLowerCase() === normalizedModel);
    if (!modelInfo) {
        const supportedModels = getSupportedModels(resolved.provider).join(', ');
        logger?.error(
            `Model '${resolved.model}' not found for provider '${resolved.provider}' in LLM registry. Supported models: ${supportedModels}`
        );
        throw LLMError.unknownModel(resolved.provider, resolved.model);
    }

    logger?.debug(
        `Found max tokens for ${resolved.provider}/${resolved.model}: ${modelInfo.maxInputTokens}`
    );
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
    const normalizedModel = stripBedrockRegionPrefix(model).toLowerCase();
    return providerInfo.models.some((m) => m.name.toLowerCase() === normalizedModel);
}

/**
 * Infers the LLM provider from the model name by searching the registry.
 * Matches the model name (case-insensitive) against all registered models.
 * Returns the provider name if found, or 'unknown' if not found.
 *
 * @param model The model name (e.g., 'gpt-5-mini', 'claude-sonnet-4-5-20250929')
 * @returns The inferred provider name ('openai', 'anthropic', etc.), or 'unknown' if no match is found.
 */
export function getProviderFromModel(model: string): LLMProvider {
    // Handle OpenRouter format models (e.g., 'anthropic/claude-opus-4.5')
    if (model.includes('/')) {
        const [prefix, ...rest] = model.split('/');
        const modelName = rest.join('/');
        if (prefix) {
            const normalizedPrefix = prefix.toLowerCase();
            // Check if prefix matches a known provider's openrouterPrefix (case-insensitive)
            for (const provider of LLM_PROVIDERS) {
                const providerPrefix = getOpenrouterPrefix(provider);
                if (providerPrefix?.toLowerCase() === normalizedPrefix) {
                    // Verify model exists in this provider's registry before returning
                    const providerInfo = LLM_REGISTRY[provider];
                    const normalizedModelName = stripBedrockRegionPrefix(modelName).toLowerCase();
                    const existsInProvider = providerInfo.models.some(
                        (m) =>
                            m.name.toLowerCase() === normalizedModelName ||
                            m.openrouterId?.toLowerCase() === model.toLowerCase()
                    );
                    if (existsInProvider) {
                        return provider;
                    }
                    // Model not found in matched provider - fall through to registry scan
                    break;
                }
            }
        }
    }

    const normalizedModel = stripBedrockRegionPrefix(model).toLowerCase();
    for (const provider of LLM_PROVIDERS) {
        const info = LLM_REGISTRY[provider];
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
 * Gets the OpenRouter prefix for a provider from the registry.
 * Returns undefined if the provider doesn't have a prefix (e.g., groq models already have vendor prefixes).
 */
function getOpenrouterPrefix(provider: LLMProvider): string | undefined {
    return LLM_REGISTRY[provider].openrouterPrefix;
}

/**
 * Providers whose models are accessible via gateway providers with supportsAllRegistryModels.
 * Derived from providers that have openrouterPrefix OR whose models don't need transformation (groq).
 */
const GATEWAY_ACCESSIBLE_PROVIDERS: LLMProvider[] = (
    Object.entries(LLM_REGISTRY) as [LLMProvider, ProviderInfo][]
)
    .filter(
        ([provider, info]) =>
            // Has openrouterPrefix (needs transformation)
            info.openrouterPrefix !== undefined ||
            // Special case: groq models already have vendor prefixes, no transformation needed
            provider === 'groq'
    )
    .map(([provider]) => provider);

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

    // Collect models from all gateway-accessible providers
    const allModels: Array<ModelInfo & { originalProvider: LLMProvider }> = [];

    for (const sourceProvider of GATEWAY_ACCESSIBLE_PROVIDERS) {
        const sourceInfo = LLM_REGISTRY[sourceProvider];
        for (const model of sourceInfo.models) {
            allModels.push({
                ...model,
                originalProvider: sourceProvider,
            });
        }
    }

    return allModels;
}

/**
 * Transforms a model name to the format required by a gateway provider (dexto/openrouter).
 * Uses the explicit openrouterId mapping from the registry - no fallback guessing.
 *
 * Transformation is needed when:
 * - Target is a gateway (dexto/openrouter)
 * - Original provider is a "native" provider (anthropic, openai, google, etc.)
 *
 * No transformation needed when:
 * - Target is not a gateway
 * - Original provider is already a gateway (dexto/openrouter) - model is already in correct format
 * - Model already contains a slash (already in OpenRouter format)
 * - Provider models have vendor prefixes (groq's meta-llama/)
 *
 * @param model The model name to transform.
 * @param originalProvider The provider the model originally belongs to.
 * @param targetProvider The provider to transform the model name for.
 * @returns The transformed model name.
 * @throws {LLMError} If model requires transformation but has no openrouterId mapping.
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

    // For providers without openrouterPrefix (like groq whose models already have vendor prefixes),
    // no transformation needed
    const prefix = getOpenrouterPrefix(originalProvider);
    if (!prefix) {
        return model;
    }

    // Look up the explicit openrouterId mapping - no fallback
    // Use case-insensitive matching for consistency with other registry lookups
    const providerInfo = LLM_REGISTRY[originalProvider];
    if (providerInfo) {
        const normalizedModel = model.toLowerCase();
        const modelInfo = providerInfo.models.find((m) => m.name.toLowerCase() === normalizedModel);
        if (modelInfo?.openrouterId) {
            return modelInfo.openrouterId;
        }
    }

    // No mapping found - this is a bug in our registry
    throw new DextoRuntimeError(
        LLMErrorCode.MODEL_UNKNOWN,
        ErrorScope.LLM,
        ErrorType.SYSTEM,
        `Model '${model}' from provider '${originalProvider}' has no openrouterId mapping. ` +
            `All models that can be used via gateway providers must have explicit openrouterId in the registry.`,
        { model, originalProvider, targetProvider }
    );
}

/**
 * Finds the original provider for a model when accessed through a gateway provider.
 * This is needed to look up model metadata (pricing, file types, etc.) from the original registry.
 * @param model The model name (may include provider prefix like 'openai/gpt-5-mini').
 * @param gatewayProvider The gateway provider being used (e.g., 'dexto').
 * @returns The original provider and normalized model name, or null if not found.
 */
export function resolveModelOrigin(
    model: string,
    gatewayProvider: LLMProvider
): { provider: LLMProvider; model: string } | null {
    // If the gateway doesn't support all registry models, model belongs to the gateway itself
    if (!hasAllRegistryModelsSupport(gatewayProvider)) {
        return { provider: gatewayProvider, model };
    }

    // Check if model has a provider prefix (e.g., 'openai/gpt-5-mini')
    if (model.includes('/')) {
        const [prefix, ...rest] = model.split('/');
        const modelName = rest.join('/');

        // Find provider by prefix (case-insensitive)
        if (prefix) {
            const normalizedPrefix = prefix.toLowerCase();
            for (const provider of LLM_PROVIDERS) {
                const providerPrefix = getOpenrouterPrefix(provider);
                if (providerPrefix?.toLowerCase() === normalizedPrefix) {
                    // Reverse lookup: find native model name via openrouterId
                    // e.g., 'anthropic/claude-opus-4.5' → 'claude-opus-4-5-20251101'
                    const providerInfo = LLM_REGISTRY[provider];
                    const nativeModel = providerInfo?.models.find(
                        (m) => m.openrouterId?.toLowerCase() === model.toLowerCase()
                    );
                    if (nativeModel) {
                        return { provider, model: nativeModel.name };
                    }
                    // Fallback: return extracted model name (may be custom or already native)
                    return { provider, model: modelName };
                }
            }
        }

        // For models with vendor prefix (like meta-llama/llama-3.3-70b), check all accessible providers
        // The full model name including prefix might be in the registry (e.g., groq models)
        for (const sourceProvider of GATEWAY_ACCESSIBLE_PROVIDERS) {
            const sourceInfo = LLM_REGISTRY[sourceProvider];
            if (sourceInfo.models.some((m) => m.name.toLowerCase() === model.toLowerCase())) {
                return { provider: sourceProvider, model };
            }
        }
    }

    // No prefix - search all accessible providers for the model
    for (const sourceProvider of GATEWAY_ACCESSIBLE_PROVIDERS) {
        const sourceInfo = LLM_REGISTRY[sourceProvider];
        const normalizedModel = stripBedrockRegionPrefix(model).toLowerCase();
        if (sourceInfo.models.some((m) => m.name.toLowerCase() === normalizedModel)) {
            return { provider: sourceProvider, model };
        }
    }

    // Model not found in any registry - might be a custom model
    return null;
}

/**
 * Resolves a gateway provider to its underlying native provider.
 * For gateway providers (dexto, openrouter), finds the original provider that owns the model.
 * For native providers, returns the input unchanged.
 *
 * @example
 * resolveToNativeProvider('dexto', 'anthropic/claude-opus-4.5') → { provider: 'anthropic', model: 'claude-opus-4-5-20251101' }
 * resolveToNativeProvider('openai', 'gpt-5-mini') → { provider: 'openai', model: 'gpt-5-mini' }
 */
function resolveToNativeProvider(
    provider: LLMProvider,
    model: string
): { provider: LLMProvider; model: string } {
    if (hasAllRegistryModelsSupport(provider)) {
        const origin = resolveModelOrigin(model, provider);
        if (origin) {
            return origin;
        }
    }
    return { provider, model };
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
    const normalizedModel = stripBedrockRegionPrefix(model).toLowerCase();
    if (providerInfo.models.some((m) => m.name.toLowerCase() === normalizedModel)) {
        return true;
    }

    // If provider supports custom models, any model is valid
    if (providerInfo.supportsCustomModels) {
        return true;
    }

    // If provider supports all registry models, check if model exists in any accessible provider
    if (providerInfo.supportsAllRegistryModels) {
        const origin = resolveModelOrigin(model, provider);
        return origin !== null;
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
    // Resolve gateway providers to the original provider
    const resolved = resolveToNativeProvider(provider, model);
    const providerInfo = LLM_REGISTRY[resolved.provider];

    // For providers that accept any model name (openai-compatible, gateways with custom models)
    if (acceptsAnyModel(resolved.provider)) {
        return providerInfo.supportedFileTypes;
    }

    // Find the specific model (strip Bedrock region prefix for lookup)
    const normalizedModel = stripBedrockRegionPrefix(resolved.model).toLowerCase();
    const modelInfo = providerInfo.models.find((m) => m.name.toLowerCase() === normalizedModel);
    if (!modelInfo) {
        throw LLMError.unknownModel(resolved.provider, resolved.model);
    }

    return modelInfo.supportedFileTypes;
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
 * @throws {Error}
 * If `baseURL` is set but `maxInputTokens` is missing (indicating a Zod validation inconsistency).
 * Or if `baseURL` is not set, but model isn't found in registry.
 * TODO: make more readable
 */
export function getEffectiveMaxInputTokens(config: LLMConfig, logger: IDextoLogger): number {
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
        } catch (error: any) {
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
                logger.error(
                    `Unexpected error during registry lookup for maxInputTokens override check: ${error}`
                );
                throw error;
            }
        }
    }

    // Priority 2: OpenRouter - look up context length from cached model registry
    if (config.provider === 'openrouter') {
        const contextLength = getOpenRouterModelContextLength(config.model);
        if (contextLength !== null) {
            logger.debug(
                `Using maxInputTokens from OpenRouter registry for ${config.model}: ${contextLength}`
            );
            return contextLength;
        }
        // Cache miss or stale - fall through to default
        logger.warn(
            `OpenRouter model ${config.model} not found in cache, defaulting to ${DEFAULT_MAX_INPUT_TOKENS} tokens`
        );
        return DEFAULT_MAX_INPUT_TOKENS;
    }

    // Priority 3: baseURL is set but maxInputTokens is missing - default to 128k tokens
    if (config.baseURL) {
        logger.warn(
            `baseURL is set but maxInputTokens is missing. Defaulting to ${DEFAULT_MAX_INPUT_TOKENS}. ` +
                `Provide 'maxInputTokens' in configuration to avoid default fallback.`
        );
        return DEFAULT_MAX_INPUT_TOKENS;
    }

    // Priority 4: Check if provider accepts any model (like openai-compatible)
    if (acceptsAnyModel(config.provider)) {
        logger.debug(
            `Provider ${config.provider} accepts any model, defaulting to ${DEFAULT_MAX_INPUT_TOKENS} tokens`
        );
        return DEFAULT_MAX_INPUT_TOKENS;
    }

    // Priority 5: No override, no baseURL - use registry.
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
    } catch (error: any) {
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
            logger.error(`Unexpected error during registry lookup for maxInputTokens: ${error}`);
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
    // Resolve gateway providers to the original provider
    const resolved = resolveToNativeProvider(provider, model);
    const providerInfo = LLM_REGISTRY[resolved.provider];

    // For providers that accept any model name, no pricing available
    if (acceptsAnyModel(resolved.provider)) {
        return undefined;
    }

    const normalizedModel = stripBedrockRegionPrefix(resolved.model).toLowerCase();
    const modelInfo = providerInfo.models.find((m) => m.name.toLowerCase() === normalizedModel);
    return modelInfo?.pricing;
}

/**
 * Gets the display name for a model, falling back to the model ID if not found.
 * For gateway providers with supportsAllRegistryModels, looks up the model in its original provider.
 */
export function getModelDisplayName(model: string, provider?: LLMProvider): string {
    let inferredProvider: LLMProvider;
    try {
        inferredProvider = provider ?? getProviderFromModel(model);
    } catch {
        // Unknown model - fall back to model ID
        return model;
    }

    // Resolve gateway providers to the original provider
    const resolved = resolveToNativeProvider(inferredProvider, model);
    const providerInfo = LLM_REGISTRY[resolved.provider];

    if (!providerInfo || acceptsAnyModel(resolved.provider)) {
        return model;
    }

    const normalizedModel = stripBedrockRegionPrefix(resolved.model).toLowerCase();
    const modelInfo = providerInfo.models.find((m) => m.name.toLowerCase() === normalizedModel);
    return modelInfo?.displayName ?? model;
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
