import type { LLMProvider, ReasoningPreset } from '../types.js';
import { isReasoningCapableModel } from '../registry/index.js';

export type ReasoningSupport = {
    capable: boolean;
    supportedPresets: ReasoningPreset[];
    supportsBudgetTokens: boolean;
};

function uniq<T>(values: T[]): T[] {
    return Array.from(new Set(values));
}

/**
 * Returns a conservative, provider-aware view of which reasoning presets we can meaningfully
 * translate into provider options today.
 *
 * Note: This is "tuning support", not "whether the model can produce reasoning at all".
 * The server/UI should treat this as best-effort and avoid implying guarantees.
 */
export function getReasoningSupport(provider: LLMProvider, model: string): ReasoningSupport {
    const capable = isReasoningCapableModel(model, provider);

    // Always allow "auto" (default) and "off" (hide/disable reasoning when possible).
    const base: ReasoningPreset[] = ['auto', 'off'];

    switch (provider) {
        case 'openai': {
            if (!capable) {
                return { capable, supportedPresets: base, supportsBudgetTokens: false };
            }
            const presets: ReasoningPreset[] = ['auto', 'off', 'low', 'medium', 'high', 'max'];
            // OpenAI's xhigh is model-specific (confirmed for codex).
            if (model.toLowerCase().includes('codex')) {
                presets.push('xhigh');
            }
            return { capable, supportedPresets: uniq(presets), supportsBudgetTokens: false };
        }
        case 'anthropic':
        case 'bedrock':
        case 'google':
        case 'openrouter':
        case 'dexto': {
            // These providers support a budget-based paradigm and/or low|medium|high effort.
            // If the model isn't reasoning-capable, keep only base knobs (auto/off).
            const presets: ReasoningPreset[] = capable
                ? [
                      'auto',
                      'off',
                      'low',
                      'medium',
                      'high',
                      'max',
                      // Best-effort compatibility: OpenRouter supports passing OpenAI-like reasoning efforts
                      // for OpenAI models (and opencode exposes xhigh for codex models via OpenRouter).
                      ...(model.toLowerCase().includes('codex') ? (['xhigh'] as const) : []),
                  ]
                : base;
            return { capable, supportedPresets: uniq(presets), supportsBudgetTokens: true };
        }
        case 'vertex': {
            // Vertex can be Gemini or Claude; we still expose the shared set.
            const presets: ReasoningPreset[] = capable
                ? ['auto', 'off', 'low', 'medium', 'high', 'max']
                : base;
            return { capable, supportedPresets: uniq(presets), supportsBudgetTokens: true };
        }
        case 'openai-compatible': {
            // Best-effort: we can send a string reasoningEffort; support the common set.
            const presets: ReasoningPreset[] = capable
                ? ['auto', 'off', 'low', 'medium', 'high', 'max']
                : base;
            return { capable, supportedPresets: uniq(presets), supportsBudgetTokens: false };
        }
        default: {
            // Unknown/unsupported: we don't have tuning knobs, but "auto/off" remains safe.
            return { capable, supportedPresets: base, supportsBudgetTokens: false };
        }
    }
}
