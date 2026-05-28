import {
    buildBudgetProfile,
    nonCapableProfile,
    option,
    type ReasoningProfile,
    withDefault,
} from './shared.js';

function isBedrockAnthropicModel(model: string): boolean {
    return model.toLowerCase().includes('anthropic');
}

function isBedrockNovaModel(model: string): boolean {
    return model.toLowerCase().includes('nova');
}

export function buildBedrockReasoningProfile(model: string): ReasoningProfile {
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
                variants: [option('disabled'), option('low'), option('medium'), option('high')],
                supportsBudgetTokens: false,
            },
            'medium'
        );
    }

    return nonCapableProfile();
}
