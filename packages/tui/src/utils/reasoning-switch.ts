/**
 * Reasoning-aware model switching shared by every TUI entry point that changes the
 * active model or its reasoning settings (model selector, default-model action, API-key
 * retry, usage-cap fallback, /reasoning budget edits, Tab variant cycling).
 *
 * Every explicit change is remembered per model in the CLI reasoning preference store and
 * hydrated back the next time that model is selected, including after a restart.
 */

import type { LLMProvider, ReasoningProfile, ReasoningVariant } from '@dexto/llm';
import { getReasoningProfile } from '@dexto/llm';
import {
    getModelReasoningPreference,
    rememberModelReasoningPreference,
    resolveModelReasoningPreference,
    type ModelReasoningOverride,
    type StaleModelReasoningSetting,
} from '@dexto/agent-management';
import type { TuiAgentBackend } from '../agent-backend.js';

type ReasoningSwitchAgent = Pick<TuiAgentBackend, 'switchLLM' | 'getCurrentLLMConfig' | 'logger'>;

export interface ReasoningSwitchTarget {
    provider: LLMProvider;
    model: string;
    baseURL?: string | undefined;
    /** Variant the user explicitly picked for this switch (undefined = no explicit choice). */
    reasoningVariant?: ReasoningVariant | undefined;
}

export type ReasoningSwitchUpdate = {
    reasoning?: { variant: ReasoningVariant; budgetTokens?: number } | null;
};

export interface ReasoningSwitchPlan {
    /** Reasoning portion of the `switchLLM` update (absent key = let core apply target defaults). */
    update: ReasoningSwitchUpdate;
    /** True when a saved preference contributed to the update. */
    hydrated: boolean;
    /** Saved settings this model no longer supports; reported to the user, never applied. */
    stale: StaleModelReasoningSetting[];
}

function identityOf(target: ReasoningSwitchTarget) {
    return {
        provider: target.provider,
        model: target.model,
        ...(target.baseURL ? { baseURL: target.baseURL } : {}),
    };
}

function buildReasoningUpdate(
    profile: ReasoningProfile,
    variant: ReasoningVariant | undefined,
    budgetTokens: number | undefined
): ReasoningSwitchUpdate {
    if (variant === undefined && budgetTokens === undefined) {
        return {};
    }

    const defaultVariant = profile.defaultVariant;
    if (budgetTokens === undefined && defaultVariant !== undefined && variant === defaultVariant) {
        return { reasoning: null };
    }

    const effectiveVariant = variant ?? defaultVariant ?? profile.supportedVariants[0];
    if (effectiveVariant === undefined) {
        return {};
    }

    return {
        reasoning: {
            variant: effectiveVariant,
            ...(budgetTokens !== undefined ? { budgetTokens } : {}),
        },
    };
}

/**
 * Reasoning to store with a new default model in global preferences.
 * An explicit plan update wins. Otherwise the previous default's reasoning is kept only when
 * the default stays the same provider + model + endpoint; it never carries over to another model.
 */
export function resolveDefaultModelReasoning<TReasoning>(input: {
    existing:
        | {
              provider: LLMProvider;
              model: string;
              baseURL?: string | undefined;
              reasoning?: TReasoning | undefined;
          }
        | undefined;
    target: ReasoningSwitchTarget;
    plan: ReasoningSwitchPlan;
}): TReasoning | NonNullable<ReasoningSwitchUpdate['reasoning']> | undefined {
    const { existing, target, plan } = input;
    if ('reasoning' in plan.update) {
        return plan.update.reasoning ?? undefined;
    }
    const sameModelIdentity =
        existing !== undefined &&
        existing.provider === target.provider &&
        existing.model === target.model &&
        (existing.baseURL || undefined) === (target.baseURL || undefined);
    return sameModelIdentity ? existing.reasoning : undefined;
}

/**
 * Combine the user's explicit variant choice (if any) with the saved preference for the
 * target model, validated against the model's current reasoning profile.
 */
export async function planReasoningSwitch(
    agent: Pick<TuiAgentBackend, 'logger'>,
    target: ReasoningSwitchTarget
): Promise<ReasoningSwitchPlan> {
    const profile = getReasoningProfile(target.provider, target.model);

    let saved: ReturnType<typeof resolveModelReasoningPreference> = {
        reasoning: undefined,
        stale: [],
    };
    try {
        const { entry, warnings } = await getModelReasoningPreference(identityOf(target));
        for (const warning of warnings) {
            agent.logger.warn(warning);
        }
        saved = resolveModelReasoningPreference({ entry, profile });
    } catch (error) {
        agent.logger.debug(
            `Failed to read reasoning preferences for ${target.provider}/${target.model}: ${
                error instanceof Error ? error.message : String(error)
            }`
        );
    }

    const explicitVariant = target.reasoningVariant;
    const savedOverride = saved.reasoning ?? undefined;
    const variant = explicitVariant ?? savedOverride?.variant;
    const budgetTokens = savedOverride?.budgetTokens;

    if (variant === undefined && budgetTokens === undefined) {
        return {
            update: saved.reasoning === null ? { reasoning: null } : {},
            hydrated: saved.reasoning === null,
            stale: saved.stale,
        };
    }

    return {
        update: buildReasoningUpdate(profile, variant, budgetTokens),
        hydrated:
            (explicitVariant === undefined && savedOverride?.variant !== undefined) ||
            budgetTokens !== undefined,
        stale: saved.stale,
    };
}

/**
 * Remember the active model's current reasoning settings as the user's explicit choice.
 * `reasoning` unset on the config is recorded as an explicit reset to provider defaults.
 * Never throws: persistence failures are logged and the switch itself stands.
 */
export async function rememberReasoningPreferenceFromConfig(
    agent: Pick<TuiAgentBackend, 'getCurrentLLMConfig' | 'logger'>,
    sessionId: string | undefined
): Promise<void> {
    const config = agent.getCurrentLLMConfig(sessionId);
    const reasoning: ModelReasoningOverride | null = config.reasoning
        ? {
              variant: config.reasoning.variant,
              ...(config.reasoning.budgetTokens !== undefined
                  ? { budgetTokens: config.reasoning.budgetTokens }
                  : {}),
          }
        : null;

    try {
        await rememberModelReasoningPreference({
            model: {
                provider: config.provider,
                model: config.model,
                ...(config.baseURL ? { baseURL: config.baseURL } : {}),
            },
            reasoning,
        });
    } catch (error) {
        agent.logger.debug(
            `Failed to persist reasoning preference for ${config.provider}/${config.model}: ${
                error instanceof Error ? error.message : String(error)
            }`
        );
    }
}

/**
 * Apply a planned switch. When the user made an explicit variant choice the resulting
 * settings are persisted for the target model.
 */
export async function applyReasoningSwitchPlan(
    agent: ReasoningSwitchAgent,
    input: {
        target: ReasoningSwitchTarget;
        sessionId: string | undefined;
        plan: ReasoningSwitchPlan;
    }
): Promise<void> {
    const { target, sessionId, plan } = input;

    await agent.switchLLM(
        {
            provider: target.provider,
            model: target.model,
            ...(target.baseURL ? { baseURL: target.baseURL } : {}),
            ...plan.update,
        },
        sessionId
    );

    if (target.reasoningVariant !== undefined) {
        await rememberReasoningPreferenceFromConfig(agent, sessionId);
    }
}

/**
 * Switch the active model (session-scoped when `sessionId` is set), restoring the
 * model's saved reasoning settings and persisting explicit choices.
 */
export async function switchModelWithReasoning(
    agent: ReasoningSwitchAgent,
    input: { target: ReasoningSwitchTarget; sessionId: string | undefined }
): Promise<ReasoningSwitchPlan> {
    const plan = await planReasoningSwitch(agent, input.target);
    await applyReasoningSwitchPlan(agent, { ...input, plan });
    return plan;
}

/** One-line user-facing description of saved settings that could not be applied. */
export function describeStaleReasoningSettings(
    modelLabel: string,
    stale: StaleModelReasoningSetting[]
): string | null {
    if (stale.length === 0) return null;
    const details = stale
        .map((item) =>
            item.field === 'variant'
                ? `variant '${item.value}' (${item.reason})`
                : `budget ${item.value} (${item.reason})`
        )
        .join('; ');
    return (
        `Saved reasoning settings for ${modelLabel} were not applied: ${details}. ` +
        `Using provider defaults; pick a variant (Tab) or set a budget (/reasoning) to update them.`
    );
}

/**
 * Set (or clear with `undefined`) the reasoning budget for the active model.
 * Keeps the current variant; clearing the budget on the default variant clears the override entirely.
 */
export async function setReasoningBudgetTokens(
    agent: ReasoningSwitchAgent,
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
    await rememberReasoningPreferenceFromConfig(agent, sessionId);
}

export type CycleReasoningVariantResult =
    | { status: 'unsupported' }
    | { status: 'switched'; variant: ReasoningVariant };

/**
 * Advance the active model's reasoning variant to the next supported one (Tab cycling).
 * Preserves any explicit budget override across the cycle.
 */
export async function cycleReasoningVariant(
    agent: ReasoningSwitchAgent,
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
    await rememberReasoningPreferenceFromConfig(agent, sessionId);

    return { status: 'switched', variant: nextVariant };
}
