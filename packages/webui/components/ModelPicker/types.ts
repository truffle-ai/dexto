// Re-export types from core to avoid duplication
export type { LLMRouter, SupportedFileType, ModelInfo } from '@dexto/core';

// Import for type annotation usage
import type { LLMRouter, ModelInfo } from '@dexto/core';

// Local types that extend core types for webui-specific needs
export interface ProviderCatalog {
    name: string;
    hasApiKey: boolean;
    primaryEnvVar: string;
    supportedRouters: LLMRouter[];
    supportsBaseURL: boolean;
    models: ModelInfo[];
}

export interface CatalogResponse {
    providers?: Record<string, ProviderCatalog>;
    models?: Array<ModelInfo & { provider: string }>;
}

// Local utility types for this component
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
