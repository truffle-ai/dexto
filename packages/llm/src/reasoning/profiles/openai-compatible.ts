import { option, type ReasoningProfile, withDefault } from './shared.js';

export function buildOpenAICompatibleReasoningProfile(): ReasoningProfile {
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
