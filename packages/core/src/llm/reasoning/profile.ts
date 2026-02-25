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

type NativeReasoningProfileResolver = (model: string) => ReasoningProfile;
type NativeReasoningCapabilityChecker = (model: string) => boolean;

const NATIVE_REASONING_CAPABILITY_CHECKERS: Partial<
    Record<LLMProvider, NativeReasoningCapabilityChecker>
> = {
    openai: (model) => isReasoningCapableModel(model, 'openai'),
    google: (model) => isReasoningCapableModel(model, 'google'),
    bedrock: (model) => isReasoningCapableModel(model, 'bedrock'),
    'openai-compatible': (model) => isReasoningCapableModel(model, 'openai-compatible'),
    anthropic: (model) =>
        isReasoningCapableModel(model, 'anthropic') ||
        parseClaudeVersion(model) !== null ||
        isAnthropicAdaptiveThinkingModel(model),
    vertex: (model) =>
        isReasoningCapableModel(model, 'vertex') ||
        parseClaudeVersion(model) !== null ||
        isAnthropicAdaptiveThinkingModel(model),
};

const NATIVE_REASONING_PROFILE_RESOLVERS: Partial<
    Record<LLMProvider, NativeReasoningProfileResolver>
> = {
    openai: (model) => buildOpenAIReasoningProfile(model),
    anthropic: (model) =>
        buildAnthropicReasoningProfile({
            model,
            includeDisabled: true,
            supportsBudgetTokensForBudgetParadigm: true,
            supportsBudgetTokensForAdaptiveParadigm: false,
        }),
    bedrock: (model) => buildBedrockReasoningProfile(model),
    google: (model) =>
        buildGoogleReasoningProfile({
            model,
            includeDisabled: true,
            supportsBudgetTokensForBudgetParadigm: true,
            supportsBudgetTokensForThinkingLevelParadigm: false,
        }),
    vertex: (model) => buildVertexReasoningProfile(model),
    'openai-compatible': () => buildOpenAICompatibleReasoningProfile(),
};

function getNativeReasoningProfile(provider: LLMProvider, model: string): ReasoningProfile {
    const isCapable = NATIVE_REASONING_CAPABILITY_CHECKERS[provider]?.(model) ?? false;
    if (!isCapable) {
        return nonCapableProfile();
    }

    const resolver = NATIVE_REASONING_PROFILE_RESOLVERS[provider];
    if (!resolver) {
        return nonCapableProfile();
    }

    return resolver(model);
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
