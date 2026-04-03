import { LLM_PROVIDERS, type LLMProvider } from '@dexto/core';

const LLM_PROVIDER_SET = new Set<string>(LLM_PROVIDERS);

const PROVIDER_LABELS: Partial<Record<LLMProvider, string>> = {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    google: 'Google',
    'openai-compatible': 'OpenAI Compatible',
    openrouter: 'OpenRouter',
    'dexto-nova': 'Dexto Nova',
    xai: 'xAI',
    litellm: 'LiteLLM',
    glama: 'Glama',
    local: 'Local',
    ollama: 'Ollama',
    groq: 'Groq',
    cohere: 'Cohere',
    minimax: 'MiniMax',
    zhipuai: 'Zhipu AI',
    'google-vertex': 'Google Vertex',
    'google-vertex-anthropic': 'Google Vertex Anthropic',
    'amazon-bedrock': 'Amazon Bedrock',
};

export type ProviderSelectOption = {
    value: string;
    label: string;
    isUnsupported: boolean;
};

export function isKnownLLMProvider(value: string): value is LLMProvider {
    return LLM_PROVIDER_SET.has(value);
}

export function formatProviderLabel(provider: string): string {
    if (isKnownLLMProvider(provider)) {
        const explicitLabel = PROVIDER_LABELS[provider];
        if (explicitLabel) {
            return explicitLabel;
        }
    }

    return provider
        .split('-')
        .filter((part) => part.length > 0)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

export function getSupportedProviderIdsFromCatalog(catalog: unknown): LLMProvider[] {
    if (typeof catalog !== 'object' || catalog === null) {
        return [];
    }

    const providers = Reflect.get(catalog, 'providers');
    if (typeof providers !== 'object' || providers === null) {
        return [];
    }

    return Object.keys(providers).filter(isKnownLLMProvider);
}

export function getProviderSelectOptions(params: {
    supportedProviders: readonly LLMProvider[];
    currentProvider?: string | null;
}): ProviderSelectOption[] {
    const options = params.supportedProviders
        .map((provider) => ({
            value: provider,
            label: formatProviderLabel(provider),
            isUnsupported: false,
        }))
        .sort((left, right) => left.label.localeCompare(right.label));

    const currentProvider = params.currentProvider?.trim();
    if (!currentProvider) {
        return options;
    }

    if (options.some((option) => option.value === currentProvider)) {
        return options;
    }

    return [
        {
            value: currentProvider,
            label: `${formatProviderLabel(currentProvider)} (Unsupported)`,
            isUnsupported: true,
        },
        ...options,
    ];
}
