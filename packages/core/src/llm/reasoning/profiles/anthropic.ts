import {
    isAnthropicAdaptiveThinkingModel,
    isAnthropicOpusAdaptiveThinkingModel,
} from '../anthropic-thinking.js';
import {
    buildBudgetProfile,
    option,
    type ReasoningProfile,
    type ReasoningVariantOption,
    withDefault,
} from './shared.js';

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

export function buildAnthropicReasoningProfile(config: {
    model: string;
    includeDisabled: boolean;
    supportsBudgetTokensForBudgetParadigm: boolean;
    supportsBudgetTokensForAdaptiveParadigm: boolean;
}): ReasoningProfile {
    if (isAnthropicAdaptiveThinkingModel(config.model)) {
        return buildAnthropicAdaptiveProfile({
            model: config.model,
            includeDisabled: config.includeDisabled,
            supportsBudgetTokens: config.supportsBudgetTokensForAdaptiveParadigm,
        });
    }

    return buildBudgetProfile({
        includeDisabled: config.includeDisabled,
        supportsBudgetTokens: config.supportsBudgetTokensForBudgetParadigm,
    });
}
