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
import { isOpenRouterGatewayProvider } from '../reasoning/profiles/openrouter.js';
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

function coerceBudgetTokens(tokens: number | undefined, minimum: number): number | undefined {
    if (tokens === undefined) return undefined;
    if (!Number.isFinite(tokens)) return undefined;
    return Math.max(minimum, Math.floor(tokens));
}

function toOpenAIReasoningEffort(
    reasoningVariant: string | undefined
): OpenAIReasoningEffort | undefined {
    return reasoningVariant === 'none' ||
        reasoningVariant === 'minimal' ||
        reasoningVariant === 'low' ||
        reasoningVariant === 'medium' ||
        reasoningVariant === 'high' ||
        reasoningVariant === 'xhigh'
        ? reasoningVariant
        : undefined;
}

function toOpenAICompatibleReasoningEffort(
    reasoningVariant: string | undefined
): 'none' | 'low' | 'medium' | 'high' | undefined {
    return reasoningVariant === 'none' ||
        reasoningVariant === 'low' ||
        reasoningVariant === 'medium' ||
        reasoningVariant === 'high'
        ? reasoningVariant
        : undefined;
}

function getSelectedReasoningVariant(config: ProviderOptionsConfig): {
    reasoningVariant: string | undefined;
    hasInvalidRequestedReasoningVariant: boolean;
} {
    const profile = getReasoningProfile(config.provider, config.model);
    const requested = config.reasoning?.variant;
    if (requested !== undefined) {
        const supported = profile.variants.some((entry) => entry.id === requested);
        return {
            reasoningVariant: supported ? requested : undefined,
            hasInvalidRequestedReasoningVariant: !supported,
        };
    }
    return {
        reasoningVariant: profile.defaultVariant,
        hasInvalidRequestedReasoningVariant: false,
    };
}

function buildAnthropicProviderOptions(config: {
    model: string;
    reasoningVariant: string | undefined;
    budgetTokens: number | undefined;
    capable: boolean;
}): Record<string, Record<string, unknown>> {
    const { model, reasoningVariant, budgetTokens, capable } = config;
    const adaptiveThinking = isAnthropicAdaptiveThinkingModel(model);

    if (adaptiveThinking) {
        if (reasoningVariant === 'disabled') {
            return {
                anthropic: {
                    cacheControl: ANTHROPIC_CACHE_CONTROL,
                    sendReasoning: false,
                    thinking: { type: 'disabled' },
                },
            };
        }

        const effort =
            reasoningVariant === 'low' ||
            reasoningVariant === 'medium' ||
            reasoningVariant === 'high' ||
            reasoningVariant === 'max'
                ? reasoningVariant
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
                ...(reasoningVariant === 'disabled' ? { thinking: { type: 'disabled' } } : {}),
            },
        };
    }

    if (reasoningVariant === 'disabled') {
        return {
            anthropic: {
                cacheControl: ANTHROPIC_CACHE_CONTROL,
                sendReasoning: false,
                thinking: { type: 'disabled' },
            },
        };
    }

    const effectiveBudgetTokens = coerceBudgetTokens(
        budgetTokens ?? ANTHROPIC_DEFAULT_BUDGET_TOKENS,
        ANTHROPIC_MIN_THINKING_BUDGET_TOKENS
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
    reasoningVariant: string | undefined;
    budgetTokens: number | undefined;
}): Record<string, Record<string, unknown>> | undefined {
    const { provider, model, reasoningVariant, budgetTokens } = config;
    const profile = getReasoningProfile(provider, model);

    if (!profile.capable) {
        return undefined;
    }

    if (reasoningVariant === 'disabled') {
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
        if (reasoningVariant === undefined || reasoningVariant === 'enabled') {
            return {
                openrouter: {
                    include_reasoning: true,
                },
            };
        }
        return undefined;
    }

    const explicitEffort = toOpenAIReasoningEffort(reasoningVariant);
    const effort =
        explicitEffort ??
        (profile.paradigm === 'adaptive-effort' && reasoningVariant === 'max'
            ? 'xhigh'
            : undefined);

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
    const { reasoningVariant, hasInvalidRequestedReasoningVariant } =
        getSelectedReasoningVariant(config);
    const budgetTokens = reasoning?.budgetTokens;

    // Avoid fallback coercion when an explicit (but unsupported) variant was provided.
    // Validation should catch this first, but this keeps runtime behavior strict as well.
    if (hasInvalidRequestedReasoningVariant) {
        return undefined;
    }

    if (provider === 'anthropic') {
        const capable = isReasoningCapableModel(model, 'anthropic');
        return buildAnthropicProviderOptions({ model, reasoningVariant, budgetTokens, capable });
    }

    if (provider === 'bedrock') {
        const capable = isReasoningCapableModel(model, 'bedrock');
        if (!capable) {
            return { bedrock: {} };
        }

        const isAnthropicModel = modelLower.includes('anthropic');
        const isNovaModel = modelLower.includes('nova');
        if (!isAnthropicModel && !isNovaModel) {
            return { bedrock: {} };
        }

        const bedrock: Record<string, unknown> = {};

        if (reasoningVariant === 'disabled') {
            bedrock['reasoningConfig'] = { type: 'disabled' };
            return { bedrock };
        }

        if (isAnthropicModel) {
            const effectiveBudgetTokens = coerceBudgetTokens(
                budgetTokens ?? BEDROCK_DEFAULT_BUDGET_TOKENS,
                1
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
            reasoningVariant === 'low' ||
            reasoningVariant === 'medium' ||
            reasoningVariant === 'high'
                ? reasoningVariant
                : undefined;
        if (maxReasoningEffort !== undefined) {
            bedrock['reasoningConfig'] = { type: 'enabled', maxReasoningEffort };
        }

        return { bedrock };
    }

    if (provider === 'vertex' && modelLower.includes('claude')) {
        const capable = isReasoningCapableModel(model, 'vertex');
        return buildAnthropicProviderOptions({ model, reasoningVariant, budgetTokens, capable });
    }

    if (provider === 'google' || (provider === 'vertex' && !modelLower.includes('claude'))) {
        const profile = getReasoningProfile(provider, model);
        const includeThoughts = profile.capable && reasoningVariant !== 'disabled';
        const isThinkingLevel = profile.paradigm === 'thinking-level';
        const thinkingLevel =
            includeThoughts &&
            isThinkingLevel &&
            (reasoningVariant === 'minimal' ||
                reasoningVariant === 'low' ||
                reasoningVariant === 'medium' ||
                reasoningVariant === 'high')
                ? reasoningVariant
                : undefined;
        const thinkingBudgetTokens = coerceBudgetTokens(
            budgetTokens ?? GOOGLE_DEFAULT_BUDGET_TOKENS,
            1
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
        const effortCandidate = toOpenAIReasoningEffort(reasoningVariant);

        if (effortCandidate && supportsOpenAIReasoningEffort(model, effortCandidate)) {
            return {
                openai: {
                    reasoningEffort: effortCandidate,
                    ...(effortCandidate !== 'none' && { reasoningSummary: 'auto' }),
                },
            };
        }
    }

    if (isOpenRouterGatewayProvider(provider)) {
        return buildOpenRouterProviderOptions({ provider, model, reasoningVariant, budgetTokens });
    }

    if (provider === 'openai-compatible') {
        const profile = getReasoningProfile(provider, model);
        if (!profile.capable) return undefined;

        const reasoningEffort = toOpenAICompatibleReasoningEffort(reasoningVariant);
        if (reasoningEffort === undefined) return undefined;

        return {
            openaiCompatible: { reasoningEffort },
        };
    }

    return undefined;
}
