import { getSupportedOpenAIReasoningEfforts } from '../openai-reasoning-effort.js';
import { option, type ReasoningProfile, withDefault } from './shared.js';

export function buildOpenAIReasoningProfile(model: string): ReasoningProfile {
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
