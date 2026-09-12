import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { buildProviderOptions, getEffectiveReasoningBudgetTokens } from '@dexto/core/llm';
import type { LLMProvider, LLMReasoningConfig } from '@dexto/llm';
import type { TuiAgentBackend } from '../agent-backend.js';
import { rememberModelReasoningPreference } from '@dexto/agent-management';
import {
    cycleReasoningVariant,
    planReasoningSwitch,
    setReasoningBudgetTokens,
    switchModelWithReasoning,
} from './reasoning-switch.js';

type FakeLLMConfig = {
    provider: LLMProvider;
    model: string;
    baseURL?: string;
    reasoning?: LLMReasoningConfig;
};

type FakeAgent = Pick<TuiAgentBackend, 'switchLLM' | 'getCurrentLLMConfig' | 'logger'>;

/**
 * Minimal backend that applies the reasoning-update contract from
 * packages/core/src/llm/resolver.ts:
 * - no `reasoning` key: keep previous when provider/model unchanged, reset when they change
 * - `reasoning: null`: clear
 * - object: replace
 */
function createFakeAgent(initial: FakeLLMConfig): FakeAgent {
    const configs = new Map<string, FakeLLMConfig>();
    const keyFor = (sessionId: string | undefined) => sessionId ?? '';
    const read = (sessionId: string | undefined): FakeLLMConfig =>
        configs.get(keyFor(sessionId)) ?? configs.get('') ?? initial;

    const fake = {
        switchLLM: async (
            updates: {
                provider?: LLMProvider;
                model?: string;
                baseURL?: string;
                reasoning?: LLMReasoningConfig | null;
            },
            sessionId?: string
        ) => {
            const previous = read(sessionId);
            const provider = updates.provider ?? previous.provider;
            const model = updates.model ?? previous.model;
            const changed = provider !== previous.provider || model !== previous.model;
            const reasoning = (() => {
                if (!Object.prototype.hasOwnProperty.call(updates, 'reasoning')) {
                    return changed ? undefined : previous.reasoning;
                }
                if (updates.reasoning === null) return undefined;
                if (updates.reasoning === undefined) return previous.reasoning;
                return updates.reasoning;
            })();
            const baseURL = updates.baseURL
                ? updates.baseURL
                : provider === previous.provider
                  ? previous.baseURL
                  : undefined;
            configs.set(keyFor(sessionId), {
                provider,
                model,
                ...(baseURL ? { baseURL } : {}),
                ...(reasoning ? { reasoning } : {}),
            });
            return { ok: true, data: undefined, issues: [] };
        },
        getCurrentLLMConfig: (sessionId?: string) => read(sessionId),
        logger: {
            debug: () => undefined,
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
            getLevel: () => 'info',
            getLogFilePath: () => undefined,
        },
    };
    return fake as unknown as FakeAgent;
}

/** The knobs the executor would actually send for the current config. */
function effectiveReasoning(agent: FakeAgent, sessionId: string) {
    const config = agent.getCurrentLLMConfig(sessionId);
    const providerOptions = buildProviderOptions({
        provider: config.provider,
        model: config.model,
        reasoning: config.reasoning,
    });
    return {
        variant: config.reasoning?.variant,
        explicitBudgetTokens: config.reasoning?.budgetTokens,
        effectiveBudgetTokens: getEffectiveReasoningBudgetTokens(providerOptions),
    };
}

// A: budget paradigm, variants disabled/high/max (default high), supports budget tokens.
const MODEL_A = { provider: 'google' as const, model: 'gemini-2.5-flash' };
// B: effort paradigm, variants minimal/low/medium/high (default medium), no budget tokens.
const MODEL_B = { provider: 'openai' as const, model: 'gpt-5' };
const SESSION = 'session-1';

describe('reasoning-switch: per-model reasoning preferences', () => {
    let homeDir = '';
    let originalHome: string | undefined;
    let originalUserProfile: string | undefined;

    beforeEach(async () => {
        homeDir = await fs.mkdtemp(path.join(tmpdir(), 'dexto-reasoning-prefs-'));
        originalHome = process.env.HOME;
        originalUserProfile = process.env.USERPROFILE;
        process.env.HOME = homeDir;
        process.env.USERPROFILE = homeDir;
    });

    afterEach(async () => {
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalUserProfile === undefined) delete process.env.USERPROFILE;
        else process.env.USERPROFILE = originalUserProfile;
        await fs.rm(homeDir, { recursive: true, force: true });
    });

    it("A -> B -> A restores A's variant and budget through the selector path", async () => {
        const agent = createFakeAgent(MODEL_B);

        await switchModelWithReasoning(agent, {
            target: { ...MODEL_A, reasoningVariant: 'max' },
            sessionId: SESSION,
        });
        await setReasoningBudgetTokens(agent, { sessionId: SESSION, budgetTokens: 8192 });
        expect(effectiveReasoning(agent, SESSION)).toEqual({
            variant: 'max',
            explicitBudgetTokens: 8192,
            effectiveBudgetTokens: 8192,
        });

        await switchModelWithReasoning(agent, {
            target: { ...MODEL_B, reasoningVariant: 'high' },
            sessionId: SESSION,
        });
        expect(effectiveReasoning(agent, SESSION).variant).toBe('high');

        // Re-selecting A: the selector re-asks for a variant; the budget must come back.
        await switchModelWithReasoning(agent, {
            target: { ...MODEL_A, reasoningVariant: 'max' },
            sessionId: SESSION,
        });
        expect(effectiveReasoning(agent, SESSION)).toEqual({
            variant: 'max',
            explicitBudgetTokens: 8192,
            effectiveBudgetTokens: 8192,
        });
    });

    it("B -> A -> B restores B's non-default variant when no explicit variant is passed", async () => {
        const agent = createFakeAgent(MODEL_A);

        await switchModelWithReasoning(agent, {
            target: { ...MODEL_B, reasoningVariant: 'high' },
            sessionId: SESSION,
        });
        await switchModelWithReasoning(agent, {
            target: { ...MODEL_A, reasoningVariant: 'high' },
            sessionId: SESSION,
        });
        // Entry points without a variant sub-step (custom model save, fallback) pass no variant.
        await switchModelWithReasoning(agent, { target: { ...MODEL_B }, sessionId: SESSION });

        expect(effectiveReasoning(agent, SESSION).variant).toBe('high');
    });

    it('Tab cycling and budget edits are remembered across a switch away and back', async () => {
        const agent = createFakeAgent(MODEL_B);

        await switchModelWithReasoning(agent, {
            target: { ...MODEL_A, reasoningVariant: 'high' },
            sessionId: SESSION,
        });
        await setReasoningBudgetTokens(agent, { sessionId: SESSION, budgetTokens: 4096 });
        // high -> max (Tab keeps the budget)
        const cycled = await cycleReasoningVariant(agent, { sessionId: SESSION });
        expect(cycled).toEqual({ status: 'switched', variant: 'max' });

        await switchModelWithReasoning(agent, {
            target: { ...MODEL_B, reasoningVariant: 'medium' },
            sessionId: SESSION,
        });
        await switchModelWithReasoning(agent, { target: { ...MODEL_A }, sessionId: SESSION });

        expect(effectiveReasoning(agent, SESSION)).toEqual({
            variant: 'max',
            explicitBudgetTokens: 4096,
            effectiveBudgetTokens: 4096,
        });
    });

    it('preferences survive a restart with the same CLI home', async () => {
        const firstRun = createFakeAgent(MODEL_B);
        await switchModelWithReasoning(firstRun, {
            target: { ...MODEL_A, reasoningVariant: 'max' },
            sessionId: SESSION,
        });
        await setReasoningBudgetTokens(firstRun, { sessionId: SESSION, budgetTokens: 8192 });
        await switchModelWithReasoning(firstRun, {
            target: { ...MODEL_B, reasoningVariant: 'high' },
            sessionId: SESSION,
        });

        // "Restart": a fresh backend with no in-memory state, same home directory.
        const secondRun = createFakeAgent(MODEL_B);
        await switchModelWithReasoning(secondRun, { target: { ...MODEL_A }, sessionId: SESSION });
        expect(effectiveReasoning(secondRun, SESSION)).toEqual({
            variant: 'max',
            explicitBudgetTokens: 8192,
            effectiveBudgetTokens: 8192,
        });

        await switchModelWithReasoning(secondRun, { target: { ...MODEL_B }, sessionId: SESSION });
        expect(effectiveReasoning(secondRun, SESSION).variant).toBe('high');
    });

    it("the same model name on a different provider never inherits the other provider's budget", async () => {
        const agent = createFakeAgent(MODEL_B);
        const anthropicSonnet = { provider: 'anthropic' as const, model: 'claude-sonnet-4-5' };
        const vertexSonnet = { provider: 'vertex' as const, model: 'claude-sonnet-4-5' };

        await switchModelWithReasoning(agent, {
            target: { ...anthropicSonnet, reasoningVariant: 'enabled' },
            sessionId: SESSION,
        });
        await setReasoningBudgetTokens(agent, { sessionId: SESSION, budgetTokens: 4096 });

        await switchModelWithReasoning(agent, { target: { ...vertexSonnet }, sessionId: SESSION });
        const vertexEffective = effectiveReasoning(agent, SESSION);
        expect(vertexEffective.explicitBudgetTokens).toBeUndefined();
        expect(vertexEffective.effectiveBudgetTokens).not.toBe(4096);

        await switchModelWithReasoning(agent, {
            target: { ...anthropicSonnet },
            sessionId: SESSION,
        });
        expect(effectiveReasoning(agent, SESSION).effectiveBudgetTokens).toBe(4096);
    });

    it('leaves the switch update untouched when nothing is saved for the target', async () => {
        const agent = createFakeAgent(MODEL_B);
        const plan = await planReasoningSwitch(agent, { ...MODEL_A });
        expect(plan).toEqual({ update: {}, hydrated: false, stale: [] });

        const explicit = await planReasoningSwitch(agent, { ...MODEL_A, reasoningVariant: 'max' });
        expect(explicit.update).toEqual({ reasoning: { variant: 'max' } });
        expect(explicit.hydrated).toBe(false);
    });

    it('reports a saved variant the model no longer supports instead of applying it', async () => {
        // A previous build (or a different catalog) saved a variant B does not offer today.
        await rememberModelReasoningPreference({
            model: MODEL_B,
            reasoning: { variant: 'ultra' },
        });
        const agent = createFakeAgent(MODEL_A);

        const plan = await switchModelWithReasoning(agent, {
            target: { ...MODEL_B },
            sessionId: SESSION,
        });

        expect(effectiveReasoning(agent, SESSION).variant).toBeUndefined();
        expect(plan.update).toEqual({});
        expect(plan.hydrated).toBe(false);
        expect(plan.stale).toEqual([
            {
                field: 'variant',
                value: 'ultra',
                reason: 'supported variants are now: minimal, low, medium, high',
            },
        ]);
    });

    it('remembers an explicit reset distinctly from never having chosen', async () => {
        const agent = createFakeAgent(MODEL_B);
        await switchModelWithReasoning(agent, {
            target: { ...MODEL_A, reasoningVariant: 'max' },
            sessionId: SESSION,
        });
        await setReasoningBudgetTokens(agent, { sessionId: SESSION, budgetTokens: 8192 });

        // Back to the default variant, then clear the budget: an explicit reset.
        await cycleReasoningVariant(agent, { sessionId: SESSION }); // max -> disabled
        await cycleReasoningVariant(agent, { sessionId: SESSION }); // disabled -> high (default)
        await setReasoningBudgetTokens(agent, { sessionId: SESSION, budgetTokens: undefined });
        expect(agent.getCurrentLLMConfig(SESSION).reasoning).toBeUndefined();

        await switchModelWithReasoning(agent, {
            target: { ...MODEL_B, reasoningVariant: 'high' },
            sessionId: SESSION,
        });
        const plan = await switchModelWithReasoning(agent, {
            target: { ...MODEL_A },
            sessionId: SESSION,
        });

        expect(plan.update).toEqual({ reasoning: null });
        expect(plan.hydrated).toBe(true);
        expect(effectiveReasoning(agent, SESSION)).toEqual({
            variant: undefined,
            explicitBudgetTokens: undefined,
            effectiveBudgetTokens: 16000,
        });
    });
});
