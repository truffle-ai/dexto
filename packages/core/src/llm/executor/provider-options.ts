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

function supportsOpenRouterXHigh(model: string): boolean {
    // Best-effort. opencode exposes xhigh for codex models through OpenRouter.
    // We keep conservative and only enable for codex-like model IDs.
    return model.toLowerCase().includes('codex');
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
): 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | undefined {
    // OpenAI supports a fixed set of reasoning effort values, but availability varies per model.
    // As of 2026-02-01, OpenAI documents: none|minimal|low|medium|high|xhigh, with model-specific
    // constraints (e.g. some models do not support `none`, `gpt-5-pro` may only support `high`,
    // and `xhigh` is only supported on certain newer models).
    // Keep this mapping conservative and prefer deferring to OpenAI docs when adjusting defaults:
    // https://platform.openai.com/docs/api-reference/responses
    // If the model isn't reasoning-capable, never send reasoningEffort (the SDK will warn).
    if (!isReasoningCapableModel(model)) {
        return undefined;
    }

    if (preset === 'auto') {
        return getDefaultOpenAIReasoningEffort(model);
    }

    if (preset === 'off') {
        return 'none';
    }

    if (preset === 'low' || preset === 'medium' || preset === 'high') {
        return preset;
    }

    if (preset === 'max') {
        return supportsOpenAIXHigh(model) ? 'xhigh' : 'high';
    }

    if (preset === 'xhigh') {
        return supportsOpenAIXHigh(model) ? 'xhigh' : 'high';
    }

    return undefined;
}

function supportsOpenAIXHigh(model: string): boolean {
    // We only have reliable evidence for codex today; keep conservative.
    return model.toLowerCase().includes('codex');
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
        const effectiveBudgetTokens =
            preset === 'off'
                ? undefined
                : coerceAnthropicThinkingBudgetTokens(
                      budgetTokens ??
                          (capable ? getAnthropicDefaultThinkingBudgetTokens(preset) : undefined)
                  );

        return {
            anthropic: {
                cacheControl: { type: 'ephemeral' },
                // We want reasoning available; UI can hide it.
                sendReasoning: preset !== 'off' && capable,
                ...(preset === 'off'
                    ? { thinking: { type: 'disabled' } }
                    : effectiveBudgetTokens !== undefined
                      ? { thinking: { type: 'enabled', budgetTokens: effectiveBudgetTokens } }
                      : {}),
                // Anthropic "effort" is model-specific; we prefer budgeting as the primary knob.
            },
        };
    }

    // Bedrock: reasoningConfig (provider-level, model-specific behavior handled by the SDK)
    if (provider === 'bedrock') {
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
        const effectiveBudgetTokens =
            preset === 'off'
                ? undefined
                : coerceAnthropicThinkingBudgetTokens(
                      budgetTokens ??
                          (capable ? getAnthropicDefaultThinkingBudgetTokens(preset) : undefined)
                  );

        return {
            anthropic: {
                cacheControl: { type: 'ephemeral' },
                sendReasoning: preset !== 'off' && capable,
                ...(preset === 'off'
                    ? { thinking: { type: 'disabled' } }
                    : effectiveBudgetTokens !== undefined
                      ? { thinking: { type: 'enabled', budgetTokens: effectiveBudgetTokens } }
                      : {}),
                // Anthropic "effort" is model-specific; we prefer budgeting as the primary knob.
            },
        };
    }

    // Google / Vertex Gemini: thinkingConfig + tuning
    if (provider === 'google' || (provider === 'vertex' && !modelLower.includes('claude'))) {
        const thinkingLevel = mapPresetToGoogleThinkingLevel(preset);
        return {
            google: {
                thinkingConfig: {
                    includeThoughts: preset !== 'off',
                    ...(thinkingLevel !== undefined && { thinkingLevel }),
                    ...(budgetTokens !== undefined && { thinkingBudget: budgetTokens }),
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

    // OpenRouter gateway providers (OpenRouter/Dexto) use `providerOptions.openrouter`.
    // Note: config.provider here is the Dexto provider (openrouter|dexto), not the upstream model.
    if (provider === 'openrouter' || provider === 'dexto') {
        if (preset === 'auto') {
            // Default: request reasoning details when available; UI can decide whether to display.
            return { openrouter: { includeReasoning: true } };
        }

        if (preset === 'off') {
            return { openrouter: { includeReasoning: false } };
        }

        const effort = mapPresetToOpenRouterEffort(preset, model);

        return {
            openrouter: {
                includeReasoning: true,
                reasoning:
                    budgetTokens !== undefined
                        ? { enabled: true, max_tokens: budgetTokens }
                        : effort !== undefined
                          ? { enabled: true, effort }
                          : undefined,
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
        case 'off':
            return 'minimal';
        default:
            return undefined;
    }
}

function getDefaultOpenAIReasoningEffort(
    model: string
): Exclude<ReturnType<typeof mapPresetToOpenAIReasoningEffort>, 'none' | undefined> | undefined {
    if (!isReasoningCapableModel(model)) return undefined;
    // Note: In Dexto, `auto` currently maps to an explicit effort (medium) rather than
    // omitting the provider option to allow OpenAI's server-side defaults (which may be `none`
    // for some newer models). If we want `auto` to mean "use provider default", revisit this.
    return 'medium';
}
