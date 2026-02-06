import type { SupportedFileType, LLMProvider } from '@dexto/core';

export type ModelInfo = {
    name: string;
    displayName?: string;
    default?: boolean;
    maxInputTokens: number;
    supportedFileTypes: SupportedFileType[];
    pricing?: {
        inputPerM: number;
        outputPerM: number;
        cacheReadPerM?: number;
        cacheWritePerM?: number;
        currency?: 'USD';
        unit?: 'per_million_tokens';
    };
};

export type ProviderCatalog = {
    name: string;
    hasApiKey: boolean;
    primaryEnvVar: string;
    supportsBaseURL: boolean;
    models: ModelInfo[];
};

export type CatalogResponse = { providers: Record<LLMProvider, ProviderCatalog> };

export type CurrentLLMConfigResponse = {
    config: {
        provider: string;
        model: string;
        displayName?: string;
        baseURL?: string;
        apiKey?: string;
        maxInputTokens?: number;
    };
};

export function favKey(provider: string, model: string) {
    return `${provider}|${model}`;
}

export function validateBaseURL(url: string): { isValid: boolean; error?: string } {
    const str = url.trim();
    if (!str.length) return { isValid: true };
    try {
        const u = new URL(str);
        if (!['http:', 'https:'].includes(u.protocol)) {
            return { isValid: false, error: 'URL must use http:// or https://' };
        }
        if (!u.pathname.includes('/v1')) {
            return { isValid: false, error: 'URL must include /v1 for compatibility' };
        }
        return { isValid: true };
    } catch {
        return { isValid: false, error: 'Invalid URL format' };
    }
}

export const FAVORITES_STORAGE_KEY = 'dexto:modelFavorites';
export const CUSTOM_MODELS_STORAGE_KEY = 'dexto:customModels';

// Default favorites for new users (newest/best models)
export const DEFAULT_FAVORITES = [
    'anthropic|claude-sonnet-4-5-20250929',
    'anthropic|claude-opus-4-6-20260205',
    'openai|gpt-5.1-chat-latest',
    'openai|gpt-5.1',
    'openai|gpt-5.3-codex',
    'google|gemini-3-pro-preview',
    'google|gemini-3-pro-image-preview',
];

// Minimal storage for custom models - other fields are inferred
export interface CustomModelStorage {
    name: string; // Model identifier
    baseURL: string; // OpenAI-compatible endpoint
    maxInputTokens?: number; // Optional, defaults to 128k
    maxOutputTokens?: number; // Optional, provider decides
}
