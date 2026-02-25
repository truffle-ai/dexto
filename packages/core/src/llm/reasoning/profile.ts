import type { LLMProvider } from '../types.js';
import { isReasoningCapableModel } from '../registry/index.js';
import {
    isAnthropicAdaptiveThinkingModel,
    isAnthropicOpusAdaptiveThinkingModel,
} from './anthropic-thinking.js';
import { getSupportedOpenAIReasoningEfforts } from './openai-reasoning-effort.js';
import { getOpenRouterReasoningTarget } from './profiles/openrouter.js';

export type ReasoningParadigm = 'effort' | 'adaptive-effort' | 'thinking-level' | 'budget' | 'none';

export type ReasoningVariantOption = {
    id: string;
    label: string;
};

export type ReasoningProfile = {
    capable: boolean;
    paradigm: ReasoningParadigm;
    variants: ReasoningVariantOption[];
    supportedVariants: string[];
    defaultVariant?: string;
    supportsBudgetTokens: boolean;
};

function option(id: string, label?: string): ReasoningVariantOption {
    return { id, label: label ?? id };
}

function buildBudgetProfile(config: {
    includeDisabled: boolean;
    supportsBudgetTokens: boolean;
}): ReasoningProfile {
    const variants = config.includeDisabled
        ? [option('disabled'), option('enabled')]
        : [option('enabled')];

    return withDefault(
        {
            capable: true,
            paradigm: 'budget',
            variants,
            supportsBudgetTokens: config.supportsBudgetTokens,
        },
        'enabled'
    );
}

function buildThinkingLevelProfile(config: {
    includeDisabled: boolean;
    supportsBudgetTokens: boolean;
}): ReasoningProfile {
    const variants = config.includeDisabled
        ? [option('disabled'), option('minimal'), option('low'), option('medium'), option('high')]
        : [option('minimal'), option('low'), option('medium'), option('high')];

    return withDefault(
        {
            capable: true,
            paradigm: 'thinking-level',
            variants,
            supportsBudgetTokens: config.supportsBudgetTokens,
        },
        'medium'
    );
}

function buildAnthropicAdaptiveProfile(config: {
    model: string;
    includeDisabled: boolean;
    supportsBudgetTokens: boolean;
}): ReasoningProfile {
    const variants: ReasoningVariantOption[] = [];
    if (config.includeDisabled) {
        variants.push(option('disabled'));
    }
    variants.push(option('low'), option('medium'), option('high'));

    if (isAnthropicOpusAdaptiveThinkingModel(config.model)) {
        variants.push(option('max'));
    }

    return withDefault(
        {
            capable: true,
            paradigm: 'adaptive-effort',
            variants,
            supportsBudgetTokens: config.supportsBudgetTokens,
        },
        'medium'
    );
}

function isGemini3Model(model: string): boolean {
    return model.toLowerCase().includes('gemini-3');
}

function isBedrockAnthropicModel(model: string): boolean {
    return model.toLowerCase().includes('anthropic');
}

function isBedrockNovaModel(model: string): boolean {
    return model.toLowerCase().includes('nova');
}

function withDefault(
    profile: Omit<ReasoningProfile, 'defaultVariant' | 'supportedVariants'>,
    preferredDefault: string
): ReasoningProfile {
    const hasPreferred = profile.variants.some((variant) => variant.id === preferredDefault);
    const defaultVariant = hasPreferred ? preferredDefault : profile.variants[0]?.id;
    return {
        ...profile,
        supportedVariants: profile.variants.map((variant) => variant.id),
        ...(defaultVariant !== undefined && { defaultVariant }),
    };
}

function nonCapableProfile(): ReasoningProfile {
    return {
        capable: false,
        paradigm: 'none',
        variants: [],
        supportedVariants: [],
        supportsBudgetTokens: false,
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
    const registryCapable = isReasoningCapableModel(model, provider);
    const capable =
        registryCapable ||
        ((provider === 'anthropic' ||
            provider === 'vertex' ||
            provider === 'openrouter' ||
            provider === 'dexto-nova') &&
            isAnthropicAdaptiveThinkingModel(model));

    if (!capable) {
        return nonCapableProfile();
    }

    switch (provider) {
        case 'openai': {
            const efforts = getSupportedOpenAIReasoningEfforts(model);
            return withDefault(
                {
                    capable: true,
                    paradigm: 'effort',
                    variants: efforts.map((effort) => option(effort)),
                    supportsBudgetTokens: false,
                },
                'medium'
            );
        }
        case 'anthropic': {
            if (isAnthropicAdaptiveThinkingModel(model)) {
                return buildAnthropicAdaptiveProfile({
                    model,
                    includeDisabled: true,
                    supportsBudgetTokens: false,
                });
            }

            return buildBudgetProfile({
                includeDisabled: true,
                supportsBudgetTokens: true,
            });
        }
        case 'bedrock': {
            if (isBedrockAnthropicModel(model)) {
                return buildBudgetProfile({
                    includeDisabled: true,
                    supportsBudgetTokens: true,
                });
            }

            if (isBedrockNovaModel(model)) {
                return withDefault(
                    {
                        capable: true,
                        paradigm: 'effort',
                        variants: [
                            option('disabled'),
                            option('low'),
                            option('medium'),
                            option('high'),
                        ],
                        supportsBudgetTokens: false,
                    },
                    'medium'
                );
            }

            return nonCapableProfile();
        }
        case 'google': {
            if (isGemini3Model(model)) {
                return buildThinkingLevelProfile({
                    includeDisabled: true,
                    supportsBudgetTokens: false,
                });
            }

            return buildBudgetProfile({
                includeDisabled: true,
                supportsBudgetTokens: true,
            });
        }
        case 'vertex': {
            const modelLower = model.toLowerCase();
            const isClaudeModel = modelLower.includes('claude');

            if (isClaudeModel) {
                if (isAnthropicAdaptiveThinkingModel(model)) {
                    return buildAnthropicAdaptiveProfile({
                        model,
                        includeDisabled: true,
                        supportsBudgetTokens: false,
                    });
                }

                return buildBudgetProfile({
                    includeDisabled: true,
                    supportsBudgetTokens: true,
                });
            }

            if (isGemini3Model(model)) {
                return buildThinkingLevelProfile({
                    includeDisabled: true,
                    supportsBudgetTokens: false,
                });
            }

            return buildBudgetProfile({
                includeDisabled: true,
                supportsBudgetTokens: true,
            });
        }
        case 'openrouter':
        case 'dexto-nova': {
            const target = getOpenRouterReasoningTarget(model);
            if (!target) {
                return nonCapableProfile();
            }

            if (target.kind === 'openai') {
                const efforts = getSupportedOpenAIReasoningEfforts(target.modelId);
                return withDefault(
                    {
                        capable: true,
                        paradigm: 'effort',
                        variants: efforts.map((effort) => option(effort)),
                        supportsBudgetTokens: true,
                    },
                    'medium'
                );
            }

            if (target.kind === 'anthropic') {
                if (isAnthropicAdaptiveThinkingModel(target.modelId)) {
                    return buildAnthropicAdaptiveProfile({
                        model: target.modelId,
                        includeDisabled: false,
                        supportsBudgetTokens: true,
                    });
                }

                return buildBudgetProfile({
                    includeDisabled: false,
                    supportsBudgetTokens: true,
                });
            }

            if (target.kind === 'google-gemini-3') {
                return buildThinkingLevelProfile({
                    includeDisabled: false,
                    supportsBudgetTokens: true,
                });
            }

            return nonCapableProfile();
        }
        case 'openai-compatible': {
            return withDefault(
                {
                    capable: true,
                    paradigm: 'effort',
                    variants: [option('none'), option('low'), option('medium'), option('high')],
                    supportsBudgetTokens: false,
                },
                'medium'
            );
        }
        default: {
            return nonCapableProfile();
        }
    }
}

export function supportsReasoningVariant(profile: ReasoningProfile, variant: string): boolean {
    return profile.variants.some((entry) => entry.id === variant);
}
