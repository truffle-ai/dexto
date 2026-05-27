import { buildBudgetProfile, buildThinkingLevelProfile, type ReasoningProfile } from './shared.js';

export function isGemini3Model(model: string): boolean {
    return model.toLowerCase().includes('gemini-3');
}

export function buildGoogleReasoningProfile(config: {
    model: string;
    includeDisabled: boolean;
    supportsBudgetTokensForBudgetParadigm: boolean;
    supportsBudgetTokensForThinkingLevelParadigm: boolean;
}): ReasoningProfile {
    if (isGemini3Model(config.model)) {
        return buildThinkingLevelProfile({
            includeDisabled: config.includeDisabled,
            supportsBudgetTokens: config.supportsBudgetTokensForThinkingLevelParadigm,
        });
    }

    return buildBudgetProfile({
        includeDisabled: config.includeDisabled,
        supportsBudgetTokens: config.supportsBudgetTokensForBudgetParadigm,
    });
}
