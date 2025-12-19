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
    // Add other relevant metadata if needed, e.g., supported features, cost tier
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
    // Add other provider-specific metadata if needed
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
            {
                name: 'gpt-5.1-chat-latest',
                displayName: 'GPT-5.1 Instant',
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
    },
    'openai-compatible': {
        models: [], // Empty - accepts any model name for custom endpoints
        baseURLSupport: 'required',
        supportedFileTypes: ['pdf', 'image', 'audio'], // Allow all types for custom endpoints - user assumes responsibility for model capabilities
    },
    anthropic: {
        models: [
            {
                name: 'claude-haiku-4-5-20251001',
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
                name: 'claude-sonnet-4-5-20250929',
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
                name: 'claude-opus-4-5-20251101',
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
            {
                name: 'claude-opus-4-1-20250805',
                displayName: 'Claude 4.1 Opus',
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
    },
    google: {
        models: [
            {
                name: 'gemini-3-flash-preview',
                displayName: 'Gemini 3 Flash Preview',
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
            {
                name: 'gemini-3-pro-preview',
                displayName: 'Gemini 3 Pro Preview',
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
                maxInputTokens: 1048576,
                default: true,
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
    },
    // https://docs.cohere.com/reference/models
    cohere: {
        models: [
            {
                name: 'command-a-03-2025',
                displayName: 'Command A (03-2025)',
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
    },
    // https://openrouter.ai/docs
    // OpenRouter is a unified API gateway providing access to 100+ models from various providers.
    // Model validation is handled dynamically via openrouter-model-registry.ts
    openrouter: {
        models: [], // Empty - accepts any model name (validated against OpenRouter's catalog)
        baseURLSupport: 'none', // Fixed endpoint - baseURL auto-injected in resolver, no user override allowed
        supportedFileTypes: ['pdf', 'image', 'audio'], // Allow all types - user assumes responsibility for model capabilities
    },
    // https://docs.litellm.ai/
    // LiteLLM is an OpenAI-compatible proxy that unifies 100+ LLM providers.
    // User must host their own LiteLLM proxy and provide the baseURL.
    litellm: {
        models: [], // Empty - accepts any model name (user's proxy determines available models)
        baseURLSupport: 'required', // User must provide their LiteLLM proxy URL
        supportedFileTypes: ['pdf', 'image', 'audio'], // Allow all types - user assumes responsibility for model capabilities
    },
    // https://glama.ai/
    // Glama is an OpenAI-compatible gateway providing unified access to multiple LLM providers.
    // Fixed endpoint: https://glama.ai/api/gateway/openai/v1
    glama: {
        models: [], // Empty - accepts any model name (format: provider/model e.g., openai/gpt-4o)
        baseURLSupport: 'none', // Fixed endpoint - baseURL auto-injected
        supportedFileTypes: ['pdf', 'image', 'audio'], // Allow all types - user assumes responsibility for model capabilities
    },
    // TODO: Add 'dexto' provider (similar to openrouter, uses https://api.dexto.ai/v1)
};

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
    const providerInfo = LLM_REGISTRY[provider];

    const modelInfo = providerInfo.models.find((m) => m.name.toLowerCase() === model.toLowerCase());
    if (!modelInfo) {
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
    return providerInfo.models.some((m) => m.name.toLowerCase() === model.toLowerCase());
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
    const lowerModel = model.toLowerCase();
    for (const provider of LLM_PROVIDERS) {
        const info = LLM_REGISTRY[provider];
        if (info.models.some((m) => m.name.toLowerCase() === lowerModel)) {
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
 * Gets the supported file types for a specific model.
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

    // Special case: providers that accept any model name (e.g., openai-compatible)
    if (acceptsAnyModel(provider)) {
        // For custom endpoints, use the provider-level supportedFileTypes declaration
        // This allows attachments despite unknown model capabilities (user assumes responsibility)
        return providerInfo.supportedFileTypes;
    }

    // Find the specific model
    const modelInfo = providerInfo.models.find((m) => m.name.toLowerCase() === model.toLowerCase());
    if (!modelInfo) {
        throw LLMError.unknownModel(provider, model);
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
    } catch (error: any) {
        // Handle registry lookup failures gracefully (e.g., typo in validated config)
        if (error instanceof DextoRuntimeError && error.code === LLMErrorCode.MODEL_UNKNOWN) {
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
 *
 * TODO: When adding gateway providers (openrouter, vercel-ai, dexto, etc.),
 * each gateway will be its own provider with its own pricing in the registry.
 * The gateway's pricing includes any markup, so no separate "gateway multiplier" logic is needed.
 * Example: provider: 'dexto' would have models with Dexto's pricing (base + markup baked in).
 *
 * @param provider The name of the provider.
 * @param model The name of the model.
 * @returns The pricing information for the model, or undefined if not available.
 */
export function getModelPricing(provider: LLMProvider, model: string): ModelPricing | undefined {
    const providerInfo = LLM_REGISTRY[provider];

    // Special case: providers that accept any model name (e.g., openai-compatible)
    if (acceptsAnyModel(provider)) {
        return undefined; // No pricing for custom endpoints
    }

    const modelInfo = providerInfo.models.find((m) => m.name.toLowerCase() === model.toLowerCase());
    return modelInfo?.pricing;
}

/**
 * Gets the display name for a model, falling back to the model ID if not found.
 */
export function getModelDisplayName(model: string, provider?: LLMProvider): string {
    let resolvedProvider: LLMProvider;
    try {
        resolvedProvider = provider ?? getProviderFromModel(model);
    } catch {
        // Unknown model - fall back to model ID
        return model;
    }

    const providerInfo = LLM_REGISTRY[resolvedProvider];

    if (!providerInfo || acceptsAnyModel(resolvedProvider)) {
        return model;
    }

    const modelInfo = providerInfo.models.find((m) => m.name.toLowerCase() === model.toLowerCase());
    return modelInfo?.displayName ?? model;
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
