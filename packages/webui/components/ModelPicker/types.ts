import type { LLMRouter, SupportedFileType } from '@dexto/core';

export type ModelInfo = {
    name: string;
    displayName?: string;
    default?: boolean;
    maxInputTokens: number;
    supportedFileTypes: SupportedFileType[];
    supportedRouters?: LLMRouter[];
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
    supportedRouters: LLMRouter[];
    supportsBaseURL: boolean;
    models: ModelInfo[];
};

export type CatalogResponse = { providers: Record<string, ProviderCatalog> };

export type CurrentLLMConfigResponse = {
    config: {
        provider: string;
        model: string;
        displayName?: string;
        router?: LLMRouter;
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
