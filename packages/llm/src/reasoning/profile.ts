import type { LLMProvider } from '../types.js';
import { DEFAULT_MODEL_REGISTRY, type ModelRegistry } from '../registry/index.js';
import { isAnthropicAdaptiveThinkingModel, parseClaudeVersion } from './anthropic-thinking.js';
import { buildAnthropicReasoningProfile } from './profiles/anthropic.js';
import { buildBedrockReasoningProfile } from './profiles/bedrock.js';
import { buildGoogleReasoningProfile } from './profiles/google.js';
import { buildOpenAICompatibleReasoningProfile } from './profiles/openai-compatible.js';
import { buildOpenAIReasoningProfile } from './profiles/openai.js';
import {
    getOpenRouterReasoningTarget,
    isOpenRouterGatewayProvider,
} from './profiles/openrouter.js';
import { buildVertexReasoningProfile } from './profiles/vertex.js';
import { nonCapableProfile, type ReasoningProfile } from './profiles/shared.js';

export type {
    ReasoningParadigm,
    ReasoningProfile,
    ReasoningVariantOption,
} from './profiles/shared.js';

const ANTHROPIC_PROFILE_CONFIG = {
    includeDisabled: true,
    supportsBudgetTokensForBudgetParadigm: true,
    supportsBudgetTokensForAdaptiveParadigm: false,
} as const;

const GOOGLE_PROFILE_CONFIG = {
    includeDisabled: true,
    supportsBudgetTokensForBudgetParadigm: true,
    supportsBudgetTokensForThinkingLevelParadigm: false,
} as const;

function isAnthropicStyleReasoningCapable(
    provider: 'anthropic' | 'vertex',
    model: string,
    registry: ModelRegistry
): boolean {
    return (
        registry.isReasoningCapableModel(model, provider) ||
        parseClaudeVersion(model) !== null ||
        isAnthropicAdaptiveThinkingModel(model)
    );
}

function getNativeReasoningProfile(
    provider: LLMProvider,
    model: string,
    registry: ModelRegistry
): ReasoningProfile {
    switch (provider) {
        case 'openai':
            if (!registry.isReasoningCapableModel(model, 'openai')) {
                return nonCapableProfile();
            }
            return buildOpenAIReasoningProfile(model);

        case 'anthropic':
            if (!isAnthropicStyleReasoningCapable('anthropic', model, registry)) {
                return nonCapableProfile();
            }
            return buildAnthropicReasoningProfile({ model, ...ANTHROPIC_PROFILE_CONFIG });

        case 'bedrock':
            if (
                !registry.isReasoningCapableModel(model, 'bedrock') &&
                !model.toLowerCase().includes('nova')
            ) {
                return nonCapableProfile();
            }
            return buildBedrockReasoningProfile(model);

        case 'google':
            if (!registry.isReasoningCapableModel(model, 'google')) {
                return nonCapableProfile();
            }
            return buildGoogleReasoningProfile({ model, ...GOOGLE_PROFILE_CONFIG });

        case 'vertex':
            if (!isAnthropicStyleReasoningCapable('vertex', model, registry)) {
                return nonCapableProfile();
            }
            return buildVertexReasoningProfile(model);

        case 'openai-compatible':
            if (!registry.isReasoningCapableModel(model, 'openai-compatible')) {
                return nonCapableProfile();
            }
            return buildOpenAICompatibleReasoningProfile();

        default:
            return nonCapableProfile();
    }
}

function toGatewayReasoningProfile(nativeProfile: ReasoningProfile): ReasoningProfile {
    if (!nativeProfile.capable) {
        return nonCapableProfile();
    }

    const variants =
        nativeProfile.paradigm === 'adaptive-effort'
            ? nativeProfile.variants.filter((variant) => variant.id !== 'max')
            : nativeProfile.variants.map((variant) => ({ ...variant }));
    const defaultVariant =
        // Variants are ordered lowest to highest effort, so this picks the strongest gateway-safe fallback.
        nativeProfile.defaultVariant === 'max' ? variants.at(-1)?.id : nativeProfile.defaultVariant;

    return {
        ...nativeProfile,
        variants,
        supportedVariants: variants.map((variant) => variant.id),
        supportsBudgetTokens: true,
        ...(defaultVariant !== undefined && { defaultVariant }),
    };
}

/**
 * Returns exact, model/provider-native reasoning controls available for this model.
 *
 * This is intentionally strict:
 * - No generic preset abstraction at this layer
 * - No guessed variants for unknown paradigms
 */
export function getReasoningProfile(
    provider: LLMProvider,
    model: string,
    registry: ModelRegistry = DEFAULT_MODEL_REGISTRY
): ReasoningProfile {
    if (isOpenRouterGatewayProvider(provider)) {
        const target = getOpenRouterReasoningTarget(model);
        if (!target) {
            return nonCapableProfile();
        }

        const nativeProfile = getNativeReasoningProfile(
            target.upstreamProvider,
            target.modelId,
            registry
        );
        return toGatewayReasoningProfile(nativeProfile);
    }

    return getNativeReasoningProfile(provider, model, registry);
}

export function supportsReasoningVariant(profile: ReasoningProfile, variant: string): boolean {
    return profile.variants.some((entry) => entry.id === variant);
}
