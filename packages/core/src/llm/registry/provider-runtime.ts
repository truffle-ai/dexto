export const PROVIDER_RUNTIME_CATEGORIES = [
    'direct',
    'gateway',
    'cloud',
    'self-hosted',
    'local',
] as const;

export type ProviderRuntimeCategory = (typeof PROVIDER_RUNTIME_CATEGORIES)[number];

export const PROVIDER_RUNTIME_FAMILIES = [
    'openai-responses',
    'openai-completions',
    'anthropic-messages',
    'google-generative-ai',
    'google-vertex',
    'google-vertex-anthropic',
    'bedrock-converse-stream',
    'openrouter',
    'cohere',
    'local-native',
] as const;

export type ProviderRuntimeFamily = (typeof PROVIDER_RUNTIME_FAMILIES)[number];

export type ProviderRuntimeMetadata = {
    family: ProviderRuntimeFamily;
    category: ProviderRuntimeCategory;
};

type InferProviderRuntimeMetadataOptions = {
    providerId: string;
    npm?: string | undefined;
    api?: string | undefined;
};

const PROVIDER_RUNTIME_FAMILY_OVERRIDES: Partial<Record<string, ProviderRuntimeFamily>> = {
    'dexto-nova': 'openrouter',
    local: 'local-native',
};

const PROVIDER_RUNTIME_CATEGORY_OVERRIDES: Partial<Record<string, ProviderRuntimeCategory>> = {
    glama: 'gateway',
    'dexto-nova': 'gateway',
    litellm: 'self-hosted',
    local: 'local',
    ollama: 'local',
    'openai-compatible': 'self-hosted',
    openrouter: 'gateway',
};

const NPM_RUNTIME_FAMILIES: Partial<Record<string, ProviderRuntimeFamily>> = {
    '@ai-sdk/amazon-bedrock': 'bedrock-converse-stream',
    '@ai-sdk/anthropic': 'anthropic-messages',
    '@ai-sdk/cohere': 'cohere',
    '@ai-sdk/google': 'google-generative-ai',
    '@ai-sdk/google-vertex': 'google-vertex',
    '@ai-sdk/google-vertex/anthropic': 'google-vertex-anthropic',
    '@ai-sdk/groq': 'openai-completions',
    '@ai-sdk/openai': 'openai-responses',
    '@ai-sdk/openai-compatible': 'openai-completions',
    '@ai-sdk/xai': 'openai-completions',
    '@openrouter/ai-sdk-provider': 'openrouter',
};

const CLOUD_RUNTIME_FAMILIES = new Set<ProviderRuntimeFamily>([
    'google-vertex',
    'google-vertex-anthropic',
    'bedrock-converse-stream',
]);

function isLocalApiUrl(api: string | undefined): boolean {
    if (!api) return false;
    return /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/|$)/i.test(api);
}

function inferProviderRuntimeCategory(params: {
    providerId: string;
    family: ProviderRuntimeFamily;
    api?: string | undefined;
}): ProviderRuntimeCategory {
    const override = PROVIDER_RUNTIME_CATEGORY_OVERRIDES[params.providerId];
    if (override) return override;

    if (isLocalApiUrl(params.api)) {
        return 'local';
    }

    if (params.family === 'openrouter') {
        return 'gateway';
    }

    if (params.family === 'local-native') {
        return 'local';
    }

    if (CLOUD_RUNTIME_FAMILIES.has(params.family)) {
        return 'cloud';
    }

    return 'direct';
}

export function inferProviderRuntimeMetadata(
    options: InferProviderRuntimeMetadataOptions
): ProviderRuntimeMetadata | undefined {
    const family =
        PROVIDER_RUNTIME_FAMILY_OVERRIDES[options.providerId] ??
        (options.npm ? NPM_RUNTIME_FAMILIES[options.npm] : undefined);

    if (!family) {
        return undefined;
    }

    return {
        family,
        category: inferProviderRuntimeCategory({
            providerId: options.providerId,
            family,
            api: options.api,
        }),
    };
}
