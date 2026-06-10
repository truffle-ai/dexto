import {
    isAnthropicAlwaysAdaptiveThinkingModel,
    isAnthropicAdaptiveThinkingModel,
    isAnthropicOpusAdaptiveThinkingModel,
    isAnthropicOpusXhighThinkingModel,
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
    const alwaysAdaptive = isAnthropicAlwaysAdaptiveThinkingModel(config.model);

    if (config.includeDisabled && !alwaysAdaptive) {
        variants.push(option('disabled'));
    }
    variants.push(option('low'), option('medium'), option('high'));

    if (alwaysAdaptive || isAnthropicOpusXhighThinkingModel(config.model)) {
        variants.push(option('xhigh'));
    }

    if (alwaysAdaptive || isAnthropicOpusAdaptiveThinkingModel(config.model)) {
        variants.push(option('max'));
    }

    return withDefault(
        {
            capable: true,
            paradigm: 'adaptive-effort',
            variants,
            supportsBudgetTokens: config.supportsBudgetTokens,
        },
        alwaysAdaptive ? 'high' : 'medium'
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
