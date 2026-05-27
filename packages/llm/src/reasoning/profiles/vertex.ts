import { buildAnthropicReasoningProfile } from './anthropic.js';
import { buildGoogleReasoningProfile } from './google.js';
import type { ReasoningProfile } from './shared.js';

export function buildVertexReasoningProfile(model: string): ReasoningProfile {
    const modelLower = model.toLowerCase();
    if (modelLower.includes('claude')) {
        return buildAnthropicReasoningProfile({
            model,
            includeDisabled: true,
            supportsBudgetTokensForBudgetParadigm: true,
            supportsBudgetTokensForAdaptiveParadigm: false,
        });
    }

    return buildGoogleReasoningProfile({
        model,
        includeDisabled: true,
        supportsBudgetTokensForBudgetParadigm: true,
        supportsBudgetTokensForThinkingLevelParadigm: false,
    });
}
