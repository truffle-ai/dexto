/**
 * Reasoning-aware model switching shared by every TUI entry point that changes the
 * active model (model selector, default-model action, API-key retry, usage-cap fallback).
 */

import type { LLMProvider, ReasoningVariant } from '@dexto/llm';
import { getReasoningProfile } from '@dexto/llm';
import type { TuiAgentBackend } from '../agent-backend.js';

export interface ReasoningSwitchTarget {
    provider: LLMProvider;
    model: string;
    baseURL?: string | undefined;
    /** Variant the user explicitly picked for this switch (undefined = no explicit choice). */
    reasoningVariant?: ReasoningVariant | undefined;
}

export type ReasoningSwitchUpdate = { reasoning?: { variant: ReasoningVariant } | null };

export function buildReasoningSwitchUpdate(
    provider: LLMProvider,
    model: string,
    reasoningVariant: ReasoningVariant | undefined
): ReasoningSwitchUpdate {
    if (reasoningVariant === undefined) {
        return {};
    }

    const defaultVariant = getReasoningProfile(provider, model).defaultVariant;
    if (defaultVariant !== undefined && reasoningVariant === defaultVariant) {
        return { reasoning: null };
    }

    return { reasoning: { variant: reasoningVariant } };
}

/**
 * Switch the active model (session-scoped when `sessionId` is set) applying the
 * reasoning update derived from the user's explicit variant choice.
 */
export async function switchModelWithReasoning(
    agent: Pick<TuiAgentBackend, 'switchLLM'>,
    input: { target: ReasoningSwitchTarget; sessionId: string | undefined }
): Promise<void> {
    const { provider, model, baseURL, reasoningVariant } = input.target;

    await agent.switchLLM(
        {
            provider,
            model,
            ...(baseURL ? { baseURL } : {}),
            ...buildReasoningSwitchUpdate(provider, model, reasoningVariant),
        },
        input.sessionId
    );
}

/**
 * Set (or clear with `undefined`) the reasoning budget for the active model.
 * Keeps the current variant; clearing the budget on the default variant clears the override entirely.
 */
export async function setReasoningBudgetTokens(
    agent: Pick<TuiAgentBackend, 'switchLLM' | 'getCurrentLLMConfig'>,
    input: { sessionId: string | undefined; budgetTokens: number | undefined }
): Promise<void> {
    const { sessionId, budgetTokens } = input;
    const current = agent.getCurrentLLMConfig(sessionId);
    const profile = getReasoningProfile(current.provider, current.model);
    const defaultVariant = profile.defaultVariant;
    const variant = current.reasoning?.variant ?? defaultVariant ?? profile.supportedVariants[0];
    if (variant === undefined) {
        return;
    }

    const reasoningUpdate =
        budgetTokens === undefined && defaultVariant !== undefined && variant === defaultVariant
            ? ({ reasoning: null } as const)
            : {
                  reasoning: {
                      variant,
                      ...(typeof budgetTokens === 'number' ? { budgetTokens } : {}),
                  },
              };

    await agent.switchLLM(
        {
            provider: current.provider,
            model: current.model,
            ...reasoningUpdate,
        },
        sessionId
    );
}

export type CycleReasoningVariantResult =
    | { status: 'unsupported' }
    | { status: 'switched'; variant: ReasoningVariant };

/**
 * Advance the active model's reasoning variant to the next supported one (Tab cycling).
 * Preserves any explicit budget override across the cycle.
 */
export async function cycleReasoningVariant(
    agent: Pick<TuiAgentBackend, 'switchLLM' | 'getCurrentLLMConfig'>,
    input: { sessionId: string | undefined }
): Promise<CycleReasoningVariantResult> {
    const { sessionId } = input;
    const current = agent.getCurrentLLMConfig(sessionId);
    const support = getReasoningProfile(current.provider, current.model);
    if (!support.capable || support.supportedVariants.length === 0) {
        return { status: 'unsupported' };
    }

    const variants = support.supportedVariants;
    const defaultVariant = support.defaultVariant;
    const currentVariant = current.reasoning?.variant ?? defaultVariant ?? variants[0] ?? undefined;
    const idx = currentVariant ? variants.indexOf(currentVariant) : -1;
    const nextVariant = variants[(idx >= 0 ? idx + 1 : 0) % variants.length];
    if (nextVariant === undefined) {
        return { status: 'unsupported' };
    }

    const budgetTokens = current.reasoning?.budgetTokens;
    const reasoningUpdate =
        defaultVariant !== undefined && nextVariant === defaultVariant && budgetTokens === undefined
            ? ({ reasoning: null } as const)
            : {
                  reasoning: {
                      variant: nextVariant,
                      ...(typeof budgetTokens === 'number' ? { budgetTokens } : {}),
                  },
              };

    await agent.switchLLM(
        {
            provider: current.provider,
            model: current.model,
            ...reasoningUpdate,
        },
        sessionId
    );

    return { status: 'switched', variant: nextVariant };
}
