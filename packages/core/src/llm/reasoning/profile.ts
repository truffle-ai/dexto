import type { LLMProvider } from '../types.js';
import { isReasoningCapableModel } from '../registry/index.js';
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
    model: string
): boolean {
    return (
        isReasoningCapableModel(model, provider) ||
        parseClaudeVersion(model) !== null ||
        isAnthropicAdaptiveThinkingModel(model)
    );
}

function getNativeReasoningProfile(provider: LLMProvider, model: string): ReasoningProfile {
    switch (provider) {
        case 'openai':
            if (!isReasoningCapableModel(model, 'openai')) {
                return nonCapableProfile();
            }
            return buildOpenAIReasoningProfile(model);

        case 'anthropic':
            if (!isAnthropicStyleReasoningCapable('anthropic', model)) {
                return nonCapableProfile();
            }
            return buildAnthropicReasoningProfile({ model, ...ANTHROPIC_PROFILE_CONFIG });

        case 'bedrock':
            if (!isReasoningCapableModel(model, 'bedrock')) {
                return nonCapableProfile();
            }
            return buildBedrockReasoningProfile(model);

        case 'google':
            if (!isReasoningCapableModel(model, 'google')) {
                return nonCapableProfile();
            }
            return buildGoogleReasoningProfile({ model, ...GOOGLE_PROFILE_CONFIG });

        case 'vertex':
            if (!isAnthropicStyleReasoningCapable('vertex', model)) {
                return nonCapableProfile();
            }
            return buildVertexReasoningProfile(model);

        case 'openai-compatible':
            if (!isReasoningCapableModel(model, 'openai-compatible')) {
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

    return {
        ...nativeProfile,
        variants: nativeProfile.variants.map((variant) => ({ ...variant })),
        supportedVariants: [...nativeProfile.supportedVariants],
        supportsBudgetTokens: true,
    };
}

/**
 * Returns exact, model/provider-native reasoning controls available for this model.
 *
 * This is intentionally strict:
 * - No generic preset abstraction at this layer
 * - No guessed variants for unknown paradigms
 */
export function getReasoningProfile(provider: LLMProvider, model: string): ReasoningProfile {
    if (isOpenRouterGatewayProvider(provider)) {
        const target = getOpenRouterReasoningTarget(model);
        if (!target) {
            return nonCapableProfile();
        }

        const nativeProfile = getNativeReasoningProfile(target.upstreamProvider, target.modelId);
        return toGatewayReasoningProfile(nativeProfile);
    }

    return getNativeReasoningProfile(provider, model);
}

export function supportsReasoningVariant(profile: ReasoningProfile, variant: string): boolean {
    return profile.variants.some((entry) => entry.id === variant);
}
