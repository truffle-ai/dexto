/**
 * Provider-specific options builder for Vercel AI SDK's streamText/generateText.
 *
 * Centralizes provider-specific configuration that requires explicit opt-in:
 * - Anthropic: cacheControl for prompt caching, reasoning config (effort / thinking budget)
 * - Bedrock: reasoningConfig for supported models
 * - Google/Vertex (Gemini): thinkingConfig includeThoughts + thinkingLevel/budget
 * - OpenAI: reasoningEffort for reasoning-capable models
 * - OpenRouter/Dexto: OpenRouter reasoning config (effort/max_tokens + includeReasoning)
 *
 * Caching notes:
 * - Anthropic: Requires explicit cacheControl option (we enable it)
 * - OpenAI: Automatic for prompts ≥1024 tokens (no config needed)
 * - Google: Implicit caching automatic for Gemini 2.5+ (≥1024 tokens for Flash,
 *   ≥2048 for Pro). Explicit caching requires pre-created cachedContent IDs.
 * All providers return cached token counts in the response (cachedInputTokens).
 */

import type { LLMProvider, LLMReasoningConfig, ReasoningPreset } from '../types.js';
import { isReasoningCapableModel } from '../registry/index.js';
import {
    isAnthropicAdaptiveThinkingModel,
    isAnthropicOpus46Model,
} from '../reasoning/anthropic-thinking.js';
import {
    coerceOpenAIReasoningEffort,
    supportsOpenAIReasoningEffort,
    type OpenAIReasoningEffort,
} from '../reasoning/openai-reasoning-effort.js';

export interface ProviderOptionsConfig {
    provider: LLMProvider;
    model: string;
    reasoning?: LLMReasoningConfig | undefined;
}

function normalizePreset(reasoning?: LLMReasoningConfig | undefined): ReasoningPreset {
    return reasoning?.preset ?? 'auto';
}

const ANTHROPIC_MIN_THINKING_BUDGET_TOKENS = 1024;

function getAnthropicDefaultThinkingBudgetTokens(preset: ReasoningPreset): number | undefined {
    // Coarse defaults to make preset cycling meaningfully impact Anthropic-style "thinking budget"
    // without requiring users to understand budget tokens.
    //
    // Note: We intentionally keep these conservative; unlike opencode, Dexto does not currently
    // have per-model output token limits available to compute large budgets safely.
    switch (preset) {
        case 'off':
            return undefined;
        case 'low':
            return 1024;
        case 'medium':
            return 2048;
        case 'high':
            return 4096;
        case 'max':
        case 'xhigh':
            return 8192;
        case 'auto':
        default:
            return 2048;
    }
}

function coerceAnthropicThinkingBudgetTokens(tokens: number | undefined): number | undefined {
    if (tokens === undefined) return undefined;
    return Math.max(ANTHROPIC_MIN_THINKING_BUDGET_TOKENS, Math.floor(tokens));
}

function mapPresetToLowMediumHigh(preset: ReasoningPreset): 'low' | 'medium' | 'high' | undefined {
    switch (preset) {
        case 'low':
            return 'low';
        case 'medium':
            return 'medium';
        case 'high':
        case 'max':
        case 'xhigh':
            return 'high';
        default:
            return undefined;
    }
}

function mapPresetToGoogleThinkingLevel(
    preset: ReasoningPreset
): 'minimal' | 'low' | 'medium' | 'high' | undefined {
    switch (preset) {
        case 'low':
            return 'low';
        case 'medium':
            return 'medium';
        case 'high':
        case 'max':
        case 'xhigh':
            return 'high';
        case 'auto':
        case 'off':
        default:
            return undefined;
    }
}

function mapPresetToAnthropicEffort(
    preset: ReasoningPreset,
    model: string
): 'low' | 'medium' | 'high' | 'max' | undefined {
    if (preset === 'off') return undefined;

    if (preset === 'auto') {
        // Keep "auto" cost-conscious by default. Anthropic's server-side default is `high`.
        return 'medium';
    }

    if (preset === 'low' || preset === 'medium' || preset === 'high') {
        return preset;
    }

    if (preset === 'max' || preset === 'xhigh') {
        // `max` effort is only supported on Opus 4.6 today; map conservatively for other models.
        return isAnthropicOpus46Model(model) ? 'max' : 'high';
    }

    return undefined;
}

function supportsOpenRouterXHigh(model: string): boolean {
    // Best-effort. OpenRouter forwards reasoningEffort to OpenAI for OpenAI models.
    return supportsOpenAIReasoningEffort(model, 'xhigh');
}

function mapPresetToOpenRouterEffort(
    preset: ReasoningPreset,
    model: string
): 'low' | 'medium' | 'high' | 'xhigh' | undefined {
    if (preset === 'xhigh') {
        return supportsOpenRouterXHigh(model) ? 'xhigh' : 'high';
    }
    if (preset === 'max') {
        return supportsOpenRouterXHigh(model) ? 'xhigh' : 'high';
    }
    if (preset === 'low' || preset === 'medium' || preset === 'high') {
        return preset;
    }
    return undefined;
}

function mapPresetToOpenAIReasoningEffort(
    preset: ReasoningPreset,
    model: string
): OpenAIReasoningEffort | undefined {
    // OpenAI supports a fixed set of reasoning effort values, but availability varies per model.
    // Keep this mapping conservative and prefer deferring to OpenAI docs when adjusting behavior:
    // https://platform.openai.com/docs/api-reference/responses
    // If the model isn't reasoning-capable, never send reasoningEffort (the SDK will warn).
    if (!isReasoningCapableModel(model)) {
        return undefined;
    }

    // Auto: omit the option to allow the provider/model default (varies by model).
    if (preset === 'auto') return undefined;

    const requested: OpenAIReasoningEffort | undefined = (() => {
        if (preset === 'off') return 'none';
        if (preset === 'low' || preset === 'medium' || preset === 'high') return preset;
        if (preset === 'xhigh' || preset === 'max') return 'xhigh';
        return undefined;
    })();

    if (requested === undefined) return undefined;
    return coerceOpenAIReasoningEffort(model, requested);
}

/**
 * Build provider-specific options for streamText/generateText.
 *
 * @param config Provider, model, and optional reasoning configuration
 * @returns Provider options object or undefined if no special options needed
 */
export function buildProviderOptions(
    config: ProviderOptionsConfig
): Record<string, Record<string, unknown>> | undefined {
    const { provider, model, reasoning } = config;
    const modelLower = model.toLowerCase();
    const preset = normalizePreset(reasoning);
    const budgetTokens = reasoning?.budgetTokens;

    // Anthropic: prompt caching + reasoning controls
    if (provider === 'anthropic') {
        const capable = isReasoningCapableModel(model);
        const adaptiveThinking = isAnthropicAdaptiveThinkingModel(model);
        const allowReasoning = capable || adaptiveThinking;

        // Claude 4.6+ uses the "adaptive thinking" paradigm (effort), not manual budget tokens.
        if (adaptiveThinking) {
            const effort =
                preset === 'off' || !allowReasoning
                    ? undefined
                    : mapPresetToAnthropicEffort(preset, model);

            return {
                anthropic: {
                    cacheControl: { type: 'ephemeral' },
                    sendReasoning: preset !== 'off' && allowReasoning,
                    ...(preset === 'off' || !allowReasoning
                        ? { thinking: { type: 'disabled' } }
                        : { thinking: { type: 'adaptive' } }),
                    ...(effort !== undefined && { effort }),
                },
            };
        }

        const effectiveBudgetTokens =
            preset === 'off' || !allowReasoning
                ? undefined
                : coerceAnthropicThinkingBudgetTokens(
                      budgetTokens ?? getAnthropicDefaultThinkingBudgetTokens(preset)
                  );

        return {
            anthropic: {
                cacheControl: { type: 'ephemeral' },
                // We want reasoning available; UI can hide it.
                sendReasoning: preset !== 'off' && allowReasoning,
                ...(preset === 'off'
                    ? { thinking: { type: 'disabled' } }
                    : effectiveBudgetTokens !== undefined
                      ? { thinking: { type: 'enabled', budgetTokens: effectiveBudgetTokens } }
                      : {}),
                // Note: Anthropic effort is only supported on Claude 4.6+ (adaptive thinking).
            },
        };
    }

    // Bedrock: reasoningConfig (provider-level, model-specific behavior handled by the SDK)
    if (provider === 'bedrock') {
        const capable = isReasoningCapableModel(model, 'bedrock');
        if (!capable) {
            return { bedrock: {} };
        }

        const maxReasoningEffort = mapPresetToLowMediumHigh(preset);
        return {
            bedrock: {
                ...(preset === 'off'
                    ? { reasoningConfig: { type: 'disabled' } }
                    : preset === 'auto' &&
                        budgetTokens === undefined &&
                        maxReasoningEffort === undefined
                      ? {}
                      : {
                            reasoningConfig: {
                                type: 'enabled',
                                ...(budgetTokens !== undefined && { budgetTokens }),
                                ...(maxReasoningEffort !== undefined && { maxReasoningEffort }),
                            },
                        }),
            },
        };
    }

    // Vertex Claude uses Anthropic internals; providerOptions are parsed under `anthropic`.
    if (provider === 'vertex' && modelLower.includes('claude')) {
        // Vertex Claude models use Anthropic model IDs in our config/registry.
        const capable =
            isReasoningCapableModel(model, 'anthropic') || isReasoningCapableModel(model);
        const adaptiveThinking = isAnthropicAdaptiveThinkingModel(model);
        const allowReasoning = capable || adaptiveThinking;

        if (adaptiveThinking) {
            const effort =
                preset === 'off' || !allowReasoning
                    ? undefined
                    : mapPresetToAnthropicEffort(preset, model);

            return {
                anthropic: {
                    cacheControl: { type: 'ephemeral' },
                    sendReasoning: preset !== 'off' && allowReasoning,
                    ...(preset === 'off' || !allowReasoning
                        ? { thinking: { type: 'disabled' } }
                        : { thinking: { type: 'adaptive' } }),
                    ...(effort !== undefined && { effort }),
                },
            };
        }

        const effectiveBudgetTokens =
            preset === 'off' || !allowReasoning
                ? undefined
                : coerceAnthropicThinkingBudgetTokens(
                      budgetTokens ?? getAnthropicDefaultThinkingBudgetTokens(preset)
                  );

        return {
            anthropic: {
                cacheControl: { type: 'ephemeral' },
                sendReasoning: preset !== 'off' && allowReasoning,
                ...(preset === 'off'
                    ? { thinking: { type: 'disabled' } }
                    : effectiveBudgetTokens !== undefined
                      ? { thinking: { type: 'enabled', budgetTokens: effectiveBudgetTokens } }
                      : {}),
                // Note: Anthropic effort is only supported on Claude 4.6+ (adaptive thinking).
            },
        };
    }

    // Google / Vertex Gemini: thinkingConfig + tuning
    if (provider === 'google' || (provider === 'vertex' && !modelLower.includes('claude'))) {
        const capable = isReasoningCapableModel(model, provider);
        const includeThoughts = preset !== 'off' && capable;
        const isGemini3 = modelLower.includes('gemini-3');
        const thinkingLevel =
            includeThoughts && isGemini3 ? mapPresetToGoogleThinkingLevel(preset) : undefined;
        return {
            google: {
                thinkingConfig: {
                    includeThoughts,
                    ...(includeThoughts &&
                        isGemini3 &&
                        thinkingLevel !== undefined && {
                            thinkingLevel,
                        }),
                    ...(includeThoughts &&
                        !isGemini3 &&
                        budgetTokens !== undefined && {
                            thinkingBudget: budgetTokens,
                        }),
                },
            },
        };
    }

    // OpenAI: reasoningEffort tuning
    if (provider === 'openai') {
        const reasoningEffort = mapPresetToOpenAIReasoningEffort(preset, model);
        if (reasoningEffort !== undefined) {
            return {
                openai: {
                    reasoningEffort,
                },
            };
        }
    }

    // OpenRouter gateway providers (OpenRouter/Dexto Nova) use `providerOptions.openrouter`.
    // Note: config.provider here is the Dexto provider (openrouter|dexto-nova), not the upstream model.
    if (provider === 'openrouter' || provider === 'dexto-nova') {
        const capable = isReasoningCapableModel(model);

        if (preset === 'off') {
            return { openrouter: { includeReasoning: false } };
        }

        if (!capable) {
            return { openrouter: { includeReasoning: true } };
        }

        // budgetTokens is an explicit override: apply it even when preset is 'auto'.
        if (budgetTokens !== undefined) {
            return {
                openrouter: {
                    includeReasoning: true,
                    reasoning: { enabled: true, max_tokens: budgetTokens },
                },
            };
        }

        if (preset === 'auto') {
            // Default: request reasoning details when available; UI can decide whether to display.
            return { openrouter: { includeReasoning: true } };
        }

        const effort = mapPresetToOpenRouterEffort(preset, model);

        return {
            openrouter: {
                includeReasoning: true,
                reasoning: effort !== undefined ? { enabled: true, effort } : undefined,
            },
        };
    }

    // OpenAI-compatible endpoints: best-effort (provider-specific behavior varies).
    if (provider === 'openai-compatible') {
        if (preset === 'auto') return undefined;

        const reasoningEffort = preset === 'off' ? 'none' : mapPresetToLowMediumHigh(preset);
        if (reasoningEffort === undefined) return undefined;

        return {
            // This key matches the provider name we configure in the OpenAI-compatible factory.
            openaiCompatible: { reasoningEffort },
        };
    }

    return undefined;
}
