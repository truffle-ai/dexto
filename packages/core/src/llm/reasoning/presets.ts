import type { LLMProvider, ReasoningPreset } from '../types.js';
import { isReasoningCapableModel } from '../registry/index.js';
import { isAnthropicAdaptiveThinkingModel } from './anthropic-thinking.js';
import {
    getSupportedOpenAIReasoningEfforts,
    supportsOpenAIReasoningEffort,
} from './openai-reasoning-effort.js';

export type ReasoningSupport = {
    capable: boolean;
    supportedPresets: ReasoningPreset[];
    supportsBudgetTokens: boolean;
};

function uniq<T>(values: T[]): T[] {
    return Array.from(new Set(values));
}

function isGemini3Model(model: string): boolean {
    return model.toLowerCase().includes('gemini-3');
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
            const efforts = getSupportedOpenAIReasoningEfforts(model);
            const presets: ReasoningPreset[] = ['auto'];

            // `gpt-5-pro` only supports `high` (no meaningful tuning).
            const onlyHigh = efforts.length === 1 && efforts[0] === 'high';
            if (!onlyHigh) presets.push('off');

            if (efforts.includes('low')) presets.push('low');
            if (efforts.includes('medium')) presets.push('medium');
            presets.push('high');
            if (!onlyHigh) presets.push('max');
            if (efforts.includes('xhigh')) presets.push('xhigh');
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
                      ...(supportsOpenAIReasoningEffort(model, 'xhigh')
                          ? (['xhigh'] as const)
                          : []),
                  ]
                : base;
            return { capable, supportedPresets: uniq(presets), supportsBudgetTokens: capable };
        }
        case 'google': {
            // Gemini 3 uses `thinkingLevel` (not budget tokens). Gemini 2.5 uses `thinkingBudget`.
            // We only advertise budget tokens when the model accepts them.
            const presets: ReasoningPreset[] = capable
                ? ['auto', 'off', 'low', 'medium', 'high', 'max']
                : base;
            return {
                capable,
                supportedPresets: uniq(presets),
                supportsBudgetTokens: capable && !isGemini3Model(model),
            };
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
                    : !isGemini3Model(model));

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
