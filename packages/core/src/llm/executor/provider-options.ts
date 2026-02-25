/**
 * Provider-specific options builder for Vercel AI SDK's streamText/generateText.
 *
 * Centralizes provider-specific configuration that requires explicit opt-in:
 * - Anthropic: cacheControl for prompt caching, reasoning config (effort / thinking budget)
 * - Bedrock: reasoningConfig for supported models
 * - Google/Vertex (Gemini): thinkingConfig includeThoughts + thinkingLevel/budget
 * - OpenAI: reasoningEffort for reasoning-capable models
 * - OpenRouter/Dexto: OpenRouter reasoning config (effort/max_tokens + include_reasoning)
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
    isAnthropicOpusAdaptiveThinkingModel,
    supportsAnthropicInterleavedThinking,
} from '../reasoning/anthropic-thinking.js';
import { ANTHROPIC_INTERLEAVED_THINKING_BETA } from '../reasoning/anthropic-betas.js';
import { supportsOpenRouterReasoningTuning } from '../reasoning/profiles/openrouter.js';
import {
    type OpenAIReasoningEffort,
    supportsOpenAIReasoningEffort,
} from '../reasoning/openai-reasoning-effort.js';

export interface ProviderOptionsConfig {
    provider: LLMProvider;
    model: string;
    reasoning?: LLMReasoningConfig | undefined;
}

function normalizePreset(reasoning?: LLMReasoningConfig | undefined): ReasoningPreset {
    return reasoning?.preset ?? 'medium';
}

const ANTHROPIC_MIN_THINKING_BUDGET_TOKENS = 1024;
const ANTHROPIC_CACHE_CONTROL = { type: 'ephemeral' as const };

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
        default:
            return 2048;
    }
}

function coerceAnthropicThinkingBudgetTokens(tokens: number | undefined): number | undefined {
    if (tokens === undefined) return undefined;
    if (!Number.isFinite(tokens)) return undefined;
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
        case 'off':
        default:
            return undefined;
    }
}

function getGoogleDefaultThinkingBudgetTokens(preset: ReasoningPreset): number | undefined {
    // Conservative defaults so preset cycling impacts Gemini 2.x/2.5 thinking budgets
    // without requiring users to understand provider-specific token ranges.
    //
    // Note: For Gemini 3 we use thinkingLevel instead of thinkingBudget.
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
        default:
            return undefined;
    }
}

function getBedrockDefaultThinkingBudgetTokens(preset: ReasoningPreset): number | undefined {
    // Conservative defaults for Claude models on Bedrock (budget-tokens based).
    //
    // Note: Bedrock also supports Amazon Nova reasoning via effort levels; those are handled separately.
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
        default:
            return 2048;
    }
}

function coerceGoogleThinkingBudgetTokens(tokens: number | undefined): number | undefined {
    if (tokens === undefined) return undefined;
    if (!Number.isFinite(tokens)) return undefined;
    return Math.max(1, Math.floor(tokens));
}

function coerceBedrockThinkingBudgetTokens(tokens: number | undefined): number | undefined {
    if (tokens === undefined) return undefined;
    if (!Number.isFinite(tokens)) return undefined;
    return Math.max(1, Math.floor(tokens));
}

function mapPresetToAnthropicEffort(
    preset: ReasoningPreset,
    model: string
): 'low' | 'medium' | 'high' | 'max' | undefined {
    if (preset === 'off') return undefined;

    if (preset === 'low' || preset === 'medium' || preset === 'high') {
        return preset;
    }

    if (preset === 'max' || preset === 'xhigh') {
        // `max` effort is only supported on Opus 4.6 today; map conservatively for other models.
        return isAnthropicOpusAdaptiveThinkingModel(model) ? 'max' : 'high';
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

    const requested: OpenAIReasoningEffort | undefined = (() => {
        if (preset === 'off') return 'none';
        if (preset === 'low' || preset === 'medium' || preset === 'high') return preset;
        if (preset === 'xhigh' || preset === 'max') return 'xhigh';
        return undefined;
    })();

    if (requested === undefined) return undefined;
    return supportsOpenAIReasoningEffort(model, requested) ? requested : undefined;
}

function isBedrockAnthropicModel(model: string): boolean {
    // Bedrock model IDs use prefixes like:
    // - "anthropic.claude-..." or "us.anthropic.claude-..."
    return model.toLowerCase().includes('anthropic');
}

function isBedrockNovaModel(model: string): boolean {
    // Nova model IDs use prefixes like:
    // - "amazon.nova-..." or "us.amazon.nova-..."
    return model.toLowerCase().includes('nova');
}

function buildAnthropicProviderOptions(config: {
    model: string;
    preset: ReasoningPreset;
    budgetTokens: number | undefined;
    capable: boolean;
}): Record<string, Record<string, unknown>> {
    const { model, preset, budgetTokens, capable } = config;
    const adaptiveThinking = isAnthropicAdaptiveThinkingModel(model);

    if (adaptiveThinking) {
        if (preset === 'off') {
            return {
                anthropic: {
                    cacheControl: ANTHROPIC_CACHE_CONTROL,
                    sendReasoning: false,
                    thinking: { type: 'disabled' },
                },
            };
        }

        const effort = mapPresetToAnthropicEffort(preset, model);

        return {
            anthropic: {
                cacheControl: ANTHROPIC_CACHE_CONTROL,
                sendReasoning: true,
                thinking: { type: 'adaptive' },
                ...(effort !== undefined && { effort }),
            },
        };
    }

    if (!capable) {
        return {
            anthropic: {
                cacheControl: ANTHROPIC_CACHE_CONTROL,
                sendReasoning: false,
                ...(preset === 'off' ? { thinking: { type: 'disabled' } } : {}),
            },
        };
    }

    if (preset === 'off') {
        return {
            anthropic: {
                cacheControl: ANTHROPIC_CACHE_CONTROL,
                sendReasoning: false,
                thinking: { type: 'disabled' },
            },
        };
    }

    const effectiveBudgetTokens = coerceAnthropicThinkingBudgetTokens(
        budgetTokens ?? getAnthropicDefaultThinkingBudgetTokens(preset)
    );

    return {
        anthropic: {
            cacheControl: ANTHROPIC_CACHE_CONTROL,
            // We want reasoning available; UI can hide it.
            sendReasoning: true,
            ...(effectiveBudgetTokens !== undefined
                ? { thinking: { type: 'enabled', budgetTokens: effectiveBudgetTokens } }
                : {}),
        },
    };
}

function buildOpenRouterProviderOptions(config: {
    model: string;
    preset: ReasoningPreset;
    budgetTokens: number | undefined;
}): Record<string, Record<string, unknown>> | undefined {
    const { model, preset, budgetTokens } = config;
    const capable = isReasoningCapableModel(model);
    const supportsTuning = supportsOpenRouterReasoningTuning(model);

    // Strict gating: avoid sending OpenRouter reasoning knobs to models where we expect errors.
    // Keep this aligned with getReasoningSupport(): if tuning is not supported, don't send
    // `openrouter.reasoning` or `include_reasoning` at all.
    if (!capable || !supportsTuning) {
        return undefined;
    }

    if (preset === 'off') {
        return { openrouter: { include_reasoning: false } };
    }

    // budgetTokens is an explicit override: apply it even when preset is the default.
    if (budgetTokens !== undefined) {
        return {
            openrouter: {
                include_reasoning: true,
                reasoning: { enabled: true, max_tokens: budgetTokens },
            },
        };
    }

    const effort = mapPresetToLowMediumHigh(preset);

    return {
        openrouter: {
            include_reasoning: true,
            ...(effort !== undefined ? { reasoning: { enabled: true, effort } } : {}),
        },
    };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return value as Record<string, unknown>;
}

export function getEffectiveReasoningBudgetTokens(
    providerOptions: Record<string, Record<string, unknown>> | undefined
): number | undefined {
    if (providerOptions === undefined) return undefined;

    const anthropic = asRecord(providerOptions['anthropic']);
    const thinking = asRecord(anthropic?.['thinking']);
    if (thinking?.['type'] === 'enabled' && typeof thinking['budgetTokens'] === 'number') {
        return thinking['budgetTokens'];
    }

    const google = asRecord(providerOptions['google']);
    const thinkingConfig = asRecord(google?.['thinkingConfig']);
    if (typeof thinkingConfig?.['thinkingBudget'] === 'number') {
        return thinkingConfig['thinkingBudget'];
    }

    const bedrock = asRecord(providerOptions['bedrock']);
    const reasoningConfig = asRecord(bedrock?.['reasoningConfig']);
    if (typeof reasoningConfig?.['budgetTokens'] === 'number') {
        return reasoningConfig['budgetTokens'];
    }

    const openrouter = asRecord(providerOptions['openrouter']);
    const reasoning = asRecord(openrouter?.['reasoning']);
    if (typeof reasoning?.['max_tokens'] === 'number') {
        return reasoning['max_tokens'];
    }

    return undefined;
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
        const capable = isReasoningCapableModel(model, 'anthropic');
        return buildAnthropicProviderOptions({ model, preset, budgetTokens, capable });
    }

    // Bedrock: reasoningConfig (provider-level, model-specific behavior handled by the SDK)
    if (provider === 'bedrock') {
        const capable = isReasoningCapableModel(model, 'bedrock');
        if (!capable) {
            return { bedrock: {} };
        }

        const isAnthropic = isBedrockAnthropicModel(model);
        const isNova = isBedrockNovaModel(model);

        // Bedrock supports distinct reasoning paradigms:
        // - Anthropic Claude: budget tokens (thinking) via budgetTokens
        // - Amazon Nova: effort tuning via maxReasoningEffort
        //
        // Keep this conservative: if we don't recognize the family, do not send knobs.
        if (!isAnthropic && !isNova) {
            return { bedrock: {} };
        }

        const bedrock: Record<string, unknown> = {};

        if (preset === 'off') {
            bedrock['reasoningConfig'] = { type: 'disabled' };
            return { bedrock };
        }

        if (isAnthropic) {
            const effectiveBudgetTokens = coerceBedrockThinkingBudgetTokens(
                budgetTokens ?? getBedrockDefaultThinkingBudgetTokens(preset)
            );
            if (effectiveBudgetTokens === undefined) {
                return { bedrock: {} };
            }

            bedrock['reasoningConfig'] = { type: 'enabled', budgetTokens: effectiveBudgetTokens };

            // Enable Claude interleaved thinking (no extra token cost; unlocks capability).
            // Gate this to Claude 4+ models; some gateways reject unknown beta flags.
            if (supportsAnthropicInterleavedThinking(model)) {
                bedrock['anthropicBeta'] = [ANTHROPIC_INTERLEAVED_THINKING_BETA];
            }

            return { bedrock };
        }

        const maxReasoningEffort = mapPresetToLowMediumHigh(preset);
        if (maxReasoningEffort !== undefined) {
            bedrock['reasoningConfig'] = { type: 'enabled', maxReasoningEffort };
        }

        return { bedrock };
    }

    // Vertex Claude uses Anthropic internals; providerOptions are parsed under `anthropic`.
    if (provider === 'vertex' && modelLower.includes('claude')) {
        // Important: capability lookup must use the *configured provider* ('vertex') because
        // Vertex Anthropic model IDs are Vertex-specific (e.g. "claude-3-7-sonnet@20250219").
        // Only the providerOptions key is `anthropic`.
        const capable = isReasoningCapableModel(model, 'vertex');
        return buildAnthropicProviderOptions({ model, preset, budgetTokens, capable });
    }

    // Google / Vertex Gemini: thinkingConfig + tuning
    if (provider === 'google' || (provider === 'vertex' && !modelLower.includes('claude'))) {
        const capable = isReasoningCapableModel(model, provider);
        const includeThoughts = preset !== 'off' && capable;
        const isGemini3 = modelLower.includes('gemini-3');
        const thinkingLevel =
            includeThoughts && isGemini3 ? mapPresetToGoogleThinkingLevel(preset) : undefined;
        const thinkingBudgetTokens = coerceGoogleThinkingBudgetTokens(
            budgetTokens ?? getGoogleDefaultThinkingBudgetTokens(preset)
        );
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
                        thinkingBudgetTokens !== undefined && {
                            thinkingBudget: thinkingBudgetTokens,
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
                    // OpenAI reasoning models do not expose chain-of-thought, but can stream a
                    // model-generated reasoning summary when explicitly requested.
                    //
                    // Use `auto` to keep this lightweight while still allowing the UI to display reasoning.
                    ...(preset !== 'off' && { reasoningSummary: 'auto' }),
                },
            };
        }
    }

    // OpenRouter gateway providers (OpenRouter/Dexto Nova) use `providerOptions.openrouter`.
    // Note: config.provider here is the Dexto provider (openrouter|dexto-nova), not the upstream model.
    if (provider === 'openrouter' || provider === 'dexto-nova') {
        return buildOpenRouterProviderOptions({ model, preset, budgetTokens });
    }

    // OpenAI-compatible endpoints: best-effort (provider-specific behavior varies).
    if (provider === 'openai-compatible') {
        const capable = isReasoningCapableModel(model, provider);
        if (!capable) return undefined;

        const reasoningEffort = preset === 'off' ? 'none' : mapPresetToLowMediumHigh(preset);
        if (reasoningEffort === undefined) return undefined;

        return {
            // This key matches the provider name we configure in the OpenAI-compatible factory.
            openaiCompatible: { reasoningEffort },
        };
    }

    return undefined;
}
