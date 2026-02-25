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
                const variants: ReasoningVariantOption[] = [
                    option('disabled'),
                    option('low'),
                    option('medium'),
                    option('high'),
                ];
                if (isAnthropicOpusAdaptiveThinkingModel(model)) {
                    variants.push(option('max'));
                }
                return withDefault(
                    {
                        capable: true,
                        paradigm: 'adaptive-effort',
                        variants,
                        supportsBudgetTokens: false,
                    },
                    'medium'
                );
            }

            return withDefault(
                {
                    capable: true,
                    paradigm: 'budget',
                    variants: [option('disabled'), option('enabled')],
                    supportsBudgetTokens: true,
                },
                'enabled'
            );
        }
        case 'bedrock': {
            if (isBedrockAnthropicModel(model)) {
                return withDefault(
                    {
                        capable: true,
                        paradigm: 'budget',
                        variants: [option('disabled'), option('enabled')],
                        supportsBudgetTokens: true,
                    },
                    'enabled'
                );
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
                return withDefault(
                    {
                        capable: true,
                        paradigm: 'thinking-level',
                        variants: [
                            option('disabled'),
                            option('minimal'),
                            option('low'),
                            option('medium'),
                            option('high'),
                        ],
                        supportsBudgetTokens: false,
                    },
                    'medium'
                );
            }

            return withDefault(
                {
                    capable: true,
                    paradigm: 'budget',
                    variants: [option('disabled'), option('enabled')],
                    supportsBudgetTokens: true,
                },
                'enabled'
            );
        }
        case 'vertex': {
            const modelLower = model.toLowerCase();
            const isClaudeModel = modelLower.includes('claude');

            if (isClaudeModel) {
                if (isAnthropicAdaptiveThinkingModel(model)) {
                    const variants: ReasoningVariantOption[] = [
                        option('disabled'),
                        option('low'),
                        option('medium'),
                        option('high'),
                    ];
                    if (isAnthropicOpusAdaptiveThinkingModel(model)) {
                        variants.push(option('max'));
                    }
                    return withDefault(
                        {
                            capable: true,
                            paradigm: 'adaptive-effort',
                            variants,
                            supportsBudgetTokens: false,
                        },
                        'medium'
                    );
                }

                return withDefault(
                    {
                        capable: true,
                        paradigm: 'budget',
                        variants: [option('disabled'), option('enabled')],
                        supportsBudgetTokens: true,
                    },
                    'enabled'
                );
            }

            if (isGemini3Model(model)) {
                return withDefault(
                    {
                        capable: true,
                        paradigm: 'thinking-level',
                        variants: [
                            option('disabled'),
                            option('minimal'),
                            option('low'),
                            option('medium'),
                            option('high'),
                        ],
                        supportsBudgetTokens: false,
                    },
                    'medium'
                );
            }

            return withDefault(
                {
                    capable: true,
                    paradigm: 'budget',
                    variants: [option('disabled'), option('enabled')],
                    supportsBudgetTokens: true,
                },
                'enabled'
            );
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
                    const variants: ReasoningVariantOption[] = [
                        option('low'),
                        option('medium'),
                        option('high'),
                    ];
                    if (isAnthropicOpusAdaptiveThinkingModel(target.modelId)) {
                        variants.push(option('max'));
                    }
                    return withDefault(
                        {
                            capable: true,
                            paradigm: 'adaptive-effort',
                            variants,
                            supportsBudgetTokens: true,
                        },
                        'medium'
                    );
                }

                return withDefault(
                    {
                        capable: true,
                        paradigm: 'budget',
                        variants: [option('enabled')],
                        supportsBudgetTokens: true,
                    },
                    'enabled'
                );
            }

            if (target.kind === 'google-gemini-3') {
                return withDefault(
                    {
                        capable: true,
                        paradigm: 'thinking-level',
                        variants: [
                            option('minimal'),
                            option('low'),
                            option('medium'),
                            option('high'),
                        ],
                        supportsBudgetTokens: true,
                    },
                    'medium'
                );
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
