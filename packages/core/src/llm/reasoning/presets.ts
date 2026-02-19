import type { LLMProvider, ReasoningPreset } from '../types.js';
import { isReasoningCapableModel } from '../registry/index.js';
import { isAnthropicAdaptiveThinkingModel } from './anthropic-thinking.js';

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
    const registryCapable = isReasoningCapableModel(model, provider);
    const capable =
        registryCapable ||
        ((provider === 'anthropic' ||
            provider === 'vertex' ||
            provider === 'openrouter' ||
            provider === 'dexto-nova') &&
            isAnthropicAdaptiveThinkingModel(model));

    // Always allow "auto" (default) and "off" (hide/disable reasoning when possible).
    const base: ReasoningPreset[] = ['auto', 'off'];

    switch (provider) {
        case 'openai': {
            // OpenAI reasoning effort (provider-native) includes `none|minimal|low|medium|high|xhigh`,
            // but support varies per model. Our UI presets are intentionally coarser:
            // - We expose `off` (maps to OpenAI `none` where supported)
            // - We do not currently expose OpenAI's `minimal`
            // - We expose `max` as "as much as possible" (maps to `high` or `xhigh` depending on model)
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
        case 'anthropic': {
            if (!capable) {
                return { capable, supportedPresets: base, supportsBudgetTokens: false };
            }

            const presets: ReasoningPreset[] = ['auto', 'off', 'low', 'medium', 'high', 'max'];

            // Claude 4.6 uses adaptive thinking; budget tokens are deprecated and will be removed.
            const supportsBudgetTokens = !isAnthropicAdaptiveThinkingModel(model);
            return { capable, supportedPresets: uniq(presets), supportsBudgetTokens };
        }
        case 'bedrock':
        case 'google':
        case 'openrouter':
        case 'dexto-nova': {
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
            return { capable, supportedPresets: uniq(presets), supportsBudgetTokens: capable };
        }
        case 'vertex': {
            // Vertex can be Gemini or Claude; we still expose the shared set.
            const presets: ReasoningPreset[] = capable
                ? ['auto', 'off', 'low', 'medium', 'high', 'max']
                : base;

            const supportsBudgetTokens =
                capable &&
                (model.toLowerCase().includes('claude')
                    ? !isAnthropicAdaptiveThinkingModel(model)
                    : true);

            return { capable, supportedPresets: uniq(presets), supportsBudgetTokens };
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
