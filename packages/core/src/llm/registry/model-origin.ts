import type { LLMProvider } from '../types.js';

const OPENROUTER_SEMANTIC_ORIGIN_EXCLUDED_FAMILIES = [
    'deepseek',
    'minimax',
    'glm',
    'mistral',
    'kimi',
    // Temporary workaround for OpenRouter models that intermittently error with reasoning params.
    // Keep this explicit so it's easy to remove once upstream stabilizes.
    'k2p5',
] as const;

export type OpenRouterGatewayProvider = 'openrouter' | 'dexto-nova';

export type GatewayModelOrigin = {
    upstreamProvider: LLMProvider;
    upstreamModelId: string;
};

type OpenRouterModelOriginRule = {
    upstreamProvider: LLMProvider;
    acceptsModelId: (modelId: string, fullModelLower: string) => boolean;
};

const OPENROUTER_MODEL_ORIGIN_RULES: Record<string, OpenRouterModelOriginRule> = {
    openai: {
        upstreamProvider: 'openai',
        acceptsModelId: () => true,
    },
    anthropic: {
        upstreamProvider: 'anthropic',
        acceptsModelId: () => true,
    },
    google: {
        upstreamProvider: 'google',
        acceptsModelId: (modelId) => modelId.includes('gemini-3'),
    },
};

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
    zhipuai: 'z-ai',
    'zhipuai-coding-plan': 'z-ai',
    zai: 'z-ai',
    'zai-coding-plan': 'z-ai',
    moonshotai: 'moonshotai',
    'moonshotai-cn': 'moonshotai',
};

function isOpenRouterSemanticOriginAllowlisted(modelLower: string): boolean {
    return (
        modelLower.includes('gpt') ||
        modelLower.includes('claude') ||
        modelLower.includes('gemini-3')
    );
}

function splitGatewayModelId(
    modelLower: string
): { providerPrefix: string; modelId: string } | null {
    const slashIndex = modelLower.indexOf('/');
    if (slashIndex <= 0 || slashIndex >= modelLower.length - 1) {
        return null;
    }

    return {
        providerPrefix: modelLower.slice(0, slashIndex),
        modelId: modelLower.slice(slashIndex + 1),
    };
}

export function isOpenRouterGatewayProvider(
    provider: LLMProvider
): provider is OpenRouterGatewayProvider {
    return provider === 'openrouter' || provider === 'dexto-nova';
}

export function resolveGatewayModelOrigin(
    provider: LLMProvider,
    model: string
): GatewayModelOrigin | null {
    if (!isOpenRouterGatewayProvider(provider)) {
        return null;
    }

    const modelLower = model.toLowerCase();

    for (const family of OPENROUTER_SEMANTIC_ORIGIN_EXCLUDED_FAMILIES) {
        if (modelLower.includes(family)) {
            return null;
        }
    }

    if (!isOpenRouterSemanticOriginAllowlisted(modelLower)) {
        return null;
    }

    const split = splitGatewayModelId(modelLower);
    if (!split) {
        return null;
    }

    const rule = OPENROUTER_MODEL_ORIGIN_RULES[split.providerPrefix];
    if (!rule || !rule.acceptsModelId(split.modelId, modelLower)) {
        return null;
    }

    return {
        upstreamProvider: rule.upstreamProvider,
        upstreamModelId: split.modelId,
    };
}

export function getOpenRouterCandidateModelIds(
    model: string,
    originalProvider: LLMProvider
): string[] {
    if (model.includes('/')) {
        return [model];
    }

    const prefix = OPENROUTER_PREFIX_BY_PROVIDER[originalProvider];
    if (!prefix) {
        return [];
    }

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
