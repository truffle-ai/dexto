import type { LLMProvider, ReasoningPreset } from '../types.js';
import { isReasoningCapableModel } from '../registry/index.js';
import { isAnthropicAdaptiveThinkingModel, isAnthropicOpus46Model } from './anthropic-thinking.js';
import { getSupportedOpenAIReasoningEfforts } from './openai-reasoning-effort.js';
import { supportsOpenRouterReasoningTuning } from './profiles/openrouter.js';

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

function isBedrockAnthropicModel(model: string): boolean {
    return model.toLowerCase().includes('anthropic');
}

function isBedrockNovaModel(model: string): boolean {
    return model.toLowerCase().includes('nova');
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

    // Always allow "off" (hide/disable reasoning when possible).
    const base: ReasoningPreset[] = ['off'];

    switch (provider) {
        case 'openai': {
            // OpenAI reasoning effort (provider-native) includes `none|minimal|low|medium|high|xhigh`,
            // but support varies per model. Our UI presets are intentionally coarser:
            // - We expose `off` (maps to OpenAI `none` where supported)
            // - We do not currently expose OpenAI's `minimal`
            if (!capable) {
                return { capable, supportedPresets: base, supportsBudgetTokens: false };
            }
            const efforts = getSupportedOpenAIReasoningEfforts(model);
            const presets: ReasoningPreset[] = [];

            // `off` requires provider-native support for disabling reasoning.
            if (efforts.includes('none')) presets.push('off');

            if (efforts.includes('low')) presets.push('low');
            if (efforts.includes('medium')) presets.push('medium');
            presets.push('high');
            if (efforts.includes('xhigh')) presets.push('xhigh');
            return { capable, supportedPresets: uniq(presets), supportsBudgetTokens: false };
        }
        case 'anthropic': {
            if (!capable) {
                return { capable, supportedPresets: base, supportsBudgetTokens: false };
            }

            const presets: ReasoningPreset[] = ['off', 'low', 'medium', 'high'];
            // Anthropic adaptive `effort=max` is Opus-only today.
            if (!isAnthropicAdaptiveThinkingModel(model) || isAnthropicOpus46Model(model)) {
                presets.push('max');
            }

            // Claude 4.6 uses adaptive thinking; budget tokens are deprecated and will be removed.
            const supportsBudgetTokens = !isAnthropicAdaptiveThinkingModel(model);
            return { capable, supportedPresets: uniq(presets), supportsBudgetTokens };
        }
        case 'bedrock': {
            if (!capable) {
                return { capable, supportedPresets: base, supportsBudgetTokens: false };
            }

            // Bedrock supports different reasoning paradigms by model family:
            // - Anthropic Claude: budget tokens
            // - Amazon Nova: effort levels (low|medium|high)
            const isAnthropic = isBedrockAnthropicModel(model);
            if (isAnthropic) {
                return {
                    capable,
                    supportedPresets: ['off', 'low', 'medium', 'high', 'max'],
                    supportsBudgetTokens: true,
                };
            }

            const isNova = isBedrockNovaModel(model);
            if (isNova) {
                return {
                    capable,
                    supportedPresets: ['off', 'low', 'medium', 'high'],
                    supportsBudgetTokens: false,
                };
            }

            // Unknown Bedrock family: we don't have reliable tuning knobs.
            return { capable, supportedPresets: base, supportsBudgetTokens: false };
        }
        case 'openrouter':
        case 'dexto-nova': {
            if (!capable) {
                return { capable, supportedPresets: base, supportsBudgetTokens: false };
            }

            if (!supportsOpenRouterReasoningTuning(model)) {
                return { capable: false, supportedPresets: base, supportsBudgetTokens: false };
            }

            const presets: ReasoningPreset[] = ['off', 'low', 'medium', 'high'];
            return { capable: true, supportedPresets: uniq(presets), supportsBudgetTokens: true };
        }
        case 'google': {
            // Gemini 3 uses `thinkingLevel` (not budget tokens). Gemini 2.5 uses `thinkingBudget`.
            // We only advertise budget tokens when the model accepts them.
            const presets: ReasoningPreset[] = capable
                ? ['off', 'low', 'medium', 'high', 'max']
                : base;
            return {
                capable,
                supportedPresets: uniq(presets),
                supportsBudgetTokens: capable && !isGemini3Model(model),
            };
        }
        case 'vertex': {
            // Vertex can be Gemini or Claude; we still expose the shared set.
            let presets: ReasoningPreset[] = base;
            if (capable) {
                const isClaudeModel = model.toLowerCase().includes('claude');
                if (isClaudeModel && isAnthropicAdaptiveThinkingModel(model)) {
                    presets = ['off', 'low', 'medium', 'high'];
                    if (isAnthropicOpus46Model(model)) {
                        presets.push('max');
                    }
                } else {
                    presets = ['off', 'low', 'medium', 'high', 'max'];
                }
            }

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
                ? ['off', 'low', 'medium', 'high', 'max']
                : base;
            return { capable, supportedPresets: uniq(presets), supportsBudgetTokens: false };
        }
        default: {
            // Unknown/unsupported: we don't have tuning knobs, but "off" remains safe.
            return { capable, supportedPresets: base, supportsBudgetTokens: false };
        }
    }
}
