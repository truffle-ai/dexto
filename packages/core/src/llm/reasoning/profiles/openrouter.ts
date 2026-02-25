import type { LLMProvider } from '../../types.js';

const OPENROUTER_REASONING_EXCLUDED_FAMILIES = [
    'deepseek',
    'minimax',
    'glm',
    'mistral',
    'kimi',
    // Temporary workaround for OpenRouter models that intermittently error with reasoning params.
    // Keep this explicit so it's easy to remove once upstream stabilizes.
    'k2p5',
] as const;

type OpenRouterGatewayProvider = 'openrouter' | 'dexto-nova';
type OpenRouterTargetRule = {
    upstreamProvider: LLMProvider;
    acceptsModelId: (modelId: string, fullModelLower: string) => boolean;
};

export type OpenRouterReasoningTarget = {
    upstreamProvider: LLMProvider;
    modelId: string;
};

const OPENROUTER_REASONING_TARGET_RULES: Record<string, OpenRouterTargetRule> = {
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

export function isOpenRouterGatewayProvider(
    provider: LLMProvider
): provider is OpenRouterGatewayProvider {
    return provider === 'openrouter' || provider === 'dexto-nova';
}

function isOpenRouterReasoningAllowlistedFamily(modelLower: string): boolean {
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
    if (slashIndex <= 0 || slashIndex >= modelLower.length - 1) return null;
    const providerPrefix = modelLower.slice(0, slashIndex);
    const modelId = modelLower.slice(slashIndex + 1);
    return { providerPrefix, modelId };
}

export function getOpenRouterReasoningTarget(model: string): OpenRouterReasoningTarget | null {
    const modelLower = model.toLowerCase();

    for (const family of OPENROUTER_REASONING_EXCLUDED_FAMILIES) {
        if (modelLower.includes(family)) return null;
    }

    if (!isOpenRouterReasoningAllowlistedFamily(modelLower)) {
        return null;
    }

    const split = splitGatewayModelId(modelLower);
    if (!split) return null;

    const { providerPrefix, modelId } = split;
    const rule = OPENROUTER_REASONING_TARGET_RULES[providerPrefix];
    if (!rule || !rule.acceptsModelId(modelId, modelLower)) {
        return null;
    }

    return { upstreamProvider: rule.upstreamProvider, modelId };
}
