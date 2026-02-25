/**
 * Provider-specific options builder for Vercel AI SDK's streamText/generateText.
 */

import type { LLMProvider, LLMReasoningConfig } from '../types.js';
import { isReasoningCapableModel } from '../registry/index.js';
import {
    isAnthropicAdaptiveThinkingModel,
    supportsAnthropicInterleavedThinking,
} from '../reasoning/anthropic-thinking.js';
import { ANTHROPIC_INTERLEAVED_THINKING_BETA } from '../reasoning/anthropic-betas.js';
import { getReasoningProfile } from '../reasoning/profile.js';
import {
    type OpenAIReasoningEffort,
    supportsOpenAIReasoningEffort,
} from '../reasoning/openai-reasoning-effort.js';

export interface ProviderOptionsConfig {
    provider: LLMProvider;
    model: string;
    reasoning?: LLMReasoningConfig | undefined;
}

const ANTHROPIC_MIN_THINKING_BUDGET_TOKENS = 1024;
const ANTHROPIC_DEFAULT_BUDGET_TOKENS = 2048;
const GOOGLE_DEFAULT_BUDGET_TOKENS = 2048;
const BEDROCK_DEFAULT_BUDGET_TOKENS = 2048;
const ANTHROPIC_CACHE_CONTROL = { type: 'ephemeral' as const };

function coerceAnthropicThinkingBudgetTokens(tokens: number | undefined): number | undefined {
    if (tokens === undefined) return undefined;
    if (!Number.isFinite(tokens)) return undefined;
    return Math.max(ANTHROPIC_MIN_THINKING_BUDGET_TOKENS, Math.floor(tokens));
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

function isBedrockAnthropicModel(model: string): boolean {
    return model.toLowerCase().includes('anthropic');
}

function isBedrockNovaModel(model: string): boolean {
    return model.toLowerCase().includes('nova');
}

function getSelectedVariant(config: ProviderOptionsConfig): {
    variant: string | undefined;
    hasInvalidRequestedVariant: boolean;
} {
    const profile = getReasoningProfile(config.provider, config.model);
    const requested = config.reasoning?.variant;
    if (requested !== undefined) {
        const supported = profile.variants.some((entry) => entry.id === requested);
        return {
            variant: supported ? requested : undefined,
            hasInvalidRequestedVariant: !supported,
        };
    }
    return {
        variant: profile.defaultVariant,
        hasInvalidRequestedVariant: false,
    };
}

function buildAnthropicProviderOptions(config: {
    model: string;
    variant: string | undefined;
    budgetTokens: number | undefined;
    capable: boolean;
}): Record<string, Record<string, unknown>> {
    const { model, variant, budgetTokens, capable } = config;
    const adaptiveThinking = isAnthropicAdaptiveThinkingModel(model);

    if (adaptiveThinking) {
        if (variant === 'disabled') {
            return {
                anthropic: {
                    cacheControl: ANTHROPIC_CACHE_CONTROL,
                    sendReasoning: false,
                    thinking: { type: 'disabled' },
                },
            };
        }

        const effort =
            variant === 'low' || variant === 'medium' || variant === 'high' || variant === 'max'
                ? variant
                : undefined;

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
                ...(variant === 'disabled' ? { thinking: { type: 'disabled' } } : {}),
            },
        };
    }

    if (variant === 'disabled') {
        return {
            anthropic: {
                cacheControl: ANTHROPIC_CACHE_CONTROL,
                sendReasoning: false,
                thinking: { type: 'disabled' },
            },
        };
    }

    const effectiveBudgetTokens = coerceAnthropicThinkingBudgetTokens(
        budgetTokens ?? ANTHROPIC_DEFAULT_BUDGET_TOKENS
    );

    return {
        anthropic: {
            cacheControl: ANTHROPIC_CACHE_CONTROL,
            sendReasoning: true,
            ...(effectiveBudgetTokens !== undefined
                ? { thinking: { type: 'enabled', budgetTokens: effectiveBudgetTokens } }
                : {}),
        },
    };
}

function buildOpenRouterProviderOptions(config: {
    provider: 'openrouter' | 'dexto-nova';
    model: string;
    variant: string | undefined;
    budgetTokens: number | undefined;
}): Record<string, Record<string, unknown>> | undefined {
    const { provider, model, variant, budgetTokens } = config;
    const profile = getReasoningProfile(provider, model);

    if (!profile.capable) {
        return undefined;
    }

    if (variant === 'disabled') {
        return { openrouter: { include_reasoning: false } };
    }

    if (budgetTokens !== undefined) {
        return {
            openrouter: {
                include_reasoning: true,
                reasoning: { enabled: true, max_tokens: budgetTokens },
            },
        };
    }

    if (profile.paradigm === 'budget') {
        if (variant === undefined || variant === 'enabled') {
            return {
                openrouter: {
                    include_reasoning: true,
                },
            };
        }
        return undefined;
    }

    const effort =
        variant === 'none' ||
        variant === 'minimal' ||
        variant === 'low' ||
        variant === 'medium' ||
        variant === 'high' ||
        variant === 'xhigh'
            ? variant
            : profile.paradigm === 'adaptive-effort'
              ? variant === 'max'
                  ? 'xhigh'
                  : variant === 'low' || variant === 'medium' || variant === 'high'
                    ? variant
                    : undefined
              : undefined;

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
 */
export function buildProviderOptions(
    config: ProviderOptionsConfig
): Record<string, Record<string, unknown>> | undefined {
    const { provider, model, reasoning } = config;
    const modelLower = model.toLowerCase();
    const { variant, hasInvalidRequestedVariant } = getSelectedVariant(config);
    const budgetTokens = reasoning?.budgetTokens;

    // Avoid fallback coercion when an explicit (but unsupported) variant was provided.
    // Validation should catch this first, but this keeps runtime behavior strict as well.
    if (hasInvalidRequestedVariant) {
        return undefined;
    }

    if (provider === 'anthropic') {
        const capable = isReasoningCapableModel(model, 'anthropic');
        return buildAnthropicProviderOptions({ model, variant, budgetTokens, capable });
    }

    if (provider === 'bedrock') {
        const capable = isReasoningCapableModel(model, 'bedrock');
        if (!capable) {
            return { bedrock: {} };
        }

        const isAnthropic = isBedrockAnthropicModel(model);
        const isNova = isBedrockNovaModel(model);
        if (!isAnthropic && !isNova) {
            return { bedrock: {} };
        }

        const bedrock: Record<string, unknown> = {};

        if (variant === 'disabled') {
            bedrock['reasoningConfig'] = { type: 'disabled' };
            return { bedrock };
        }

        if (isAnthropic) {
            const effectiveBudgetTokens = coerceBedrockThinkingBudgetTokens(
                budgetTokens ?? BEDROCK_DEFAULT_BUDGET_TOKENS
            );
            if (effectiveBudgetTokens === undefined) {
                return { bedrock: {} };
            }

            bedrock['reasoningConfig'] = { type: 'enabled', budgetTokens: effectiveBudgetTokens };
            if (supportsAnthropicInterleavedThinking(model)) {
                bedrock['anthropicBeta'] = [ANTHROPIC_INTERLEAVED_THINKING_BETA];
            }

            return { bedrock };
        }

        const maxReasoningEffort =
            variant === 'low' || variant === 'medium' || variant === 'high' ? variant : undefined;
        if (maxReasoningEffort !== undefined) {
            bedrock['reasoningConfig'] = { type: 'enabled', maxReasoningEffort };
        }

        return { bedrock };
    }

    if (provider === 'vertex' && modelLower.includes('claude')) {
        const capable = isReasoningCapableModel(model, 'vertex');
        return buildAnthropicProviderOptions({ model, variant, budgetTokens, capable });
    }

    if (provider === 'google' || (provider === 'vertex' && !modelLower.includes('claude'))) {
        const profile = getReasoningProfile(provider, model);
        const includeThoughts = profile.capable && variant !== 'disabled';
        const isThinkingLevel = profile.paradigm === 'thinking-level';
        const thinkingLevel =
            includeThoughts &&
            isThinkingLevel &&
            (variant === 'minimal' ||
                variant === 'low' ||
                variant === 'medium' ||
                variant === 'high')
                ? variant
                : undefined;
        const thinkingBudgetTokens = coerceGoogleThinkingBudgetTokens(
            budgetTokens ?? GOOGLE_DEFAULT_BUDGET_TOKENS
        );

        return {
            google: {
                thinkingConfig: {
                    includeThoughts,
                    ...(includeThoughts &&
                        isThinkingLevel &&
                        thinkingLevel !== undefined && {
                            thinkingLevel,
                        }),
                    ...(includeThoughts &&
                        profile.paradigm === 'budget' &&
                        thinkingBudgetTokens !== undefined && {
                            thinkingBudget: thinkingBudgetTokens,
                        }),
                },
            },
        };
    }

    if (provider === 'openai') {
        const effortCandidate =
            variant === 'none' ||
            variant === 'minimal' ||
            variant === 'low' ||
            variant === 'medium' ||
            variant === 'high' ||
            variant === 'xhigh'
                ? (variant as OpenAIReasoningEffort)
                : undefined;

        if (effortCandidate && supportsOpenAIReasoningEffort(model, effortCandidate)) {
            return {
                openai: {
                    reasoningEffort: effortCandidate,
                    ...(effortCandidate !== 'none' && { reasoningSummary: 'auto' }),
                },
            };
        }
    }

    if (provider === 'openrouter' || provider === 'dexto-nova') {
        return buildOpenRouterProviderOptions({ provider, model, variant, budgetTokens });
    }

    if (provider === 'openai-compatible') {
        const profile = getReasoningProfile(provider, model);
        if (!profile.capable) return undefined;

        const reasoningEffort =
            variant === 'none' || variant === 'low' || variant === 'medium' || variant === 'high'
                ? variant
                : undefined;
        if (reasoningEffort === undefined) return undefined;

        return {
            openaiCompatible: { reasoningEffort },
        };
    }

    return undefined;
}
