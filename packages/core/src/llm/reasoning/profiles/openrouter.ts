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

export type OpenRouterReasoningTarget =
    | {
          kind: 'openai';
          modelId: string;
      }
    | {
          kind: 'anthropic';
          modelId: string;
      }
    | {
          kind: 'google-gemini-3';
          modelId: string;
      };

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
    if (providerPrefix === 'openai') {
        return { kind: 'openai', modelId };
    }
    if (providerPrefix === 'anthropic') {
        return { kind: 'anthropic', modelId };
    }
    if (providerPrefix === 'google' && modelId.includes('gemini-3')) {
        return { kind: 'google-gemini-3', modelId };
    }

    return null;
}
