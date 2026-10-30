import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import type { ReasoningProfile } from '@dexto/llm';

let preferencesPath = '';

vi.mock('./path-resolver.js', () => ({
    getModelReasoningPreferencesPath: () => preferencesPath,
}));

import {
    MODEL_REASONING_PREFERENCES_VERSION,
    forgetModelReasoningPreference,
    getModelReasoningPreference,
    loadModelReasoningPreferences,
    parseModelReasoningPreferences,
    rememberModelReasoningPreference,
    resolveModelReasoningPreference,
    toModelReasoningPreferenceKey,
} from './model-reasoning-preferences.js';

// Synthetic profiles: A allows disabled/high/max with budgets, B allows minimal..high without.
const PROFILE_A: ReasoningProfile = {
    capable: true,
    paradigm: 'budget',
    variants: [
        { id: 'disabled', label: 'disabled' },
        { id: 'high', label: 'high' },
        { id: 'max', label: 'max' },
    ],
    supportedVariants: ['disabled', 'high', 'max'],
    defaultVariant: 'high',
    supportsBudgetTokens: true,
};
const PROFILE_B: ReasoningProfile = {
    capable: true,
    paradigm: 'effort',
    variants: [
        { id: 'minimal', label: 'minimal' },
        { id: 'low', label: 'low' },
        { id: 'medium', label: 'medium' },
        { id: 'high', label: 'high' },
    ],
    supportedVariants: ['minimal', 'low', 'medium', 'high'],
    defaultVariant: 'medium',
    supportsBudgetTokens: false,
};
const NON_CAPABLE: ReasoningProfile = {
    capable: false,
    paradigm: 'none',
    variants: [],
    supportedVariants: [],
    supportsBudgetTokens: false,
};

const MODEL_A = { provider: 'google' as const, model: 'model-a' };
const MODEL_B = { provider: 'openai' as const, model: 'model-b' };

describe('model-reasoning-preferences', () => {
    let tempDir = '';

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(tmpdir(), 'dexto-model-reasoning-prefs-'));
        preferencesPath = path.join(tempDir, 'state', 'cli', 'model-reasoning-preferences.json');
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    describe('identity key', () => {
        it('separates the same model name across providers and endpoints', () => {
            const openai = toModelReasoningPreferenceKey({ provider: 'openai', model: 'gpt-5' });
            const compatible = toModelReasoningPreferenceKey({
                provider: 'openai-compatible',
                model: 'gpt-5',
            });
            const endpointA = toModelReasoningPreferenceKey({
                provider: 'openai-compatible',
                model: 'gpt-5',
                baseURL: 'https://a.example/v1',
            });
            const endpointB = toModelReasoningPreferenceKey({
                provider: 'openai-compatible',
                model: 'gpt-5',
                baseURL: 'https://b.example/v1',
            });
            expect(new Set([openai, compatible, endpointA, endpointB]).size).toBe(4);
        });

        it('keeps identities distinct when a component contains the key separator', async () => {
            const pipedModel = { provider: 'openai-compatible' as const, model: 'a|b' };
            const modelWithEndpoint = {
                provider: 'openai-compatible' as const,
                model: 'a',
                baseURL: 'b',
            };
            expect(toModelReasoningPreferenceKey(pipedModel)).not.toBe(
                toModelReasoningPreferenceKey(modelWithEndpoint)
            );

            await rememberModelReasoningPreference({
                model: pipedModel,
                reasoning: { variant: 'high' },
            });
            await rememberModelReasoningPreference({
                model: modelWithEndpoint,
                reasoning: { variant: 'low' },
            });

            const piped = await getModelReasoningPreference(pipedModel);
            const withEndpoint = await getModelReasoningPreference(modelWithEndpoint);
            expect(piped.entry).toMatchObject({ model: 'a|b', reasoning: { variant: 'high' } });
            expect(withEndpoint.entry).toMatchObject({
                model: 'a',
                baseURL: 'b',
                reasoning: { variant: 'low' },
            });
            expect(piped.warnings).toEqual([]);
        });
    });

    describe('store', () => {
        it('returns an empty state with no warnings when the file does not exist', async () => {
            const { state, warnings } = await loadModelReasoningPreferences();
            expect(state).toEqual({ version: MODEL_REASONING_PREFERENCES_VERSION, models: {} });
            expect(warnings).toEqual([]);
        });

        it('remembers, reads back, and forgets a preference (file created atomically)', async () => {
            await rememberModelReasoningPreference({
                model: MODEL_A,
                reasoning: { variant: 'max', budgetTokens: 8192 },
            });

            const { entry } = await getModelReasoningPreference(MODEL_A);
            expect(entry).toMatchObject({
                provider: 'google',
                model: 'model-a',
                reasoning: { variant: 'max', budgetTokens: 8192 },
            });
            expect(typeof entry?.updatedAt).toBe('string');

            const files = await fs.readdir(path.dirname(preferencesPath));
            expect(files).toEqual(['model-reasoning-preferences.json']);

            const raw = JSON.parse(await fs.readFile(preferencesPath, 'utf-8'));
            expect(raw.version).toBe(MODEL_REASONING_PREFERENCES_VERSION);
            expect(Object.keys(raw.models)).toEqual(['google|model-a']);

            expect(await forgetModelReasoningPreference(MODEL_A)).toBe(true);
            expect(await forgetModelReasoningPreference(MODEL_A)).toBe(false);
            expect((await getModelReasoningPreference(MODEL_A)).entry).toBeNull();
        });

        it('keeps unset, explicit value, and explicit reset distinct', async () => {
            await rememberModelReasoningPreference({
                model: MODEL_A,
                reasoning: { budgetTokens: 4096 },
            });
            await rememberModelReasoningPreference({ model: MODEL_B, reasoning: null });

            expect((await getModelReasoningPreference(MODEL_A)).entry?.reasoning).toEqual({
                budgetTokens: 4096,
            });
            expect((await getModelReasoningPreference(MODEL_B)).entry?.reasoning).toBeNull();
            expect(
                (await getModelReasoningPreference({ provider: 'anthropic', model: 'unset' })).entry
            ).toBeNull();
        });

        it('rejects an empty override', async () => {
            await expect(
                rememberModelReasoningPreference({ model: MODEL_A, reasoning: {} })
            ).rejects.toThrow();
        });

        it('serialises concurrent writes so none are lost', async () => {
            const models = Array.from({ length: 12 }, (_, i) => ({
                provider: 'openai' as const,
                model: `concurrent-${i}`,
            }));
            await Promise.all(
                models.map((model, i) =>
                    rememberModelReasoningPreference({
                        model,
                        reasoning: { variant: i % 2 === 0 ? 'high' : 'low' },
                    })
                )
            );

            const { state } = await loadModelReasoningPreferences();
            expect(Object.keys(state.models)).toHaveLength(models.length);
        });

        it('reports a corrupt file instead of throwing, then recovers on the next write', async () => {
            await fs.mkdir(path.dirname(preferencesPath), { recursive: true });
            await fs.writeFile(preferencesPath, '{ not json', 'utf-8');

            const { state, warnings } = await loadModelReasoningPreferences();
            expect(state.models).toEqual({});
            expect(warnings).toHaveLength(1);
            expect(warnings[0]).toContain('not valid JSON');

            await rememberModelReasoningPreference({
                model: MODEL_A,
                reasoning: { variant: 'max' },
            });
            const reloaded = await loadModelReasoningPreferences();
            expect(reloaded.warnings).toEqual([]);
            expect(Object.keys(reloaded.state.models)).toEqual(['google|model-a']);
        });
    });

    describe('versioned parsing', () => {
        it('drops invalid entries individually and keeps the valid ones', () => {
            const { state, warnings } = parseModelReasoningPreferences({
                version: 1,
                models: {
                    'google|model-a': {
                        provider: 'google',
                        model: 'model-a',
                        reasoning: { variant: 'max', budgetTokens: 8192 },
                        updatedAt: '2026-09-12T00:00:00.000Z',
                    },
                    'openai|model-b': {
                        provider: 'openai',
                        model: 'model-b',
                        reasoning: { budgetTokens: -1 },
                        updatedAt: '2026-09-12T00:00:00.000Z',
                    },
                    'wrong-key': {
                        provider: 'openai',
                        model: 'model-c',
                        reasoning: null,
                        updatedAt: '2026-09-12T00:00:00.000Z',
                    },
                    'anthropic|secret': {
                        provider: 'anthropic',
                        model: 'secret',
                        apiKey: 'sk-should-never-be-here',
                        reasoning: null,
                        updatedAt: '2026-09-12T00:00:00.000Z',
                    },
                },
            });

            expect(Object.keys(state.models)).toEqual(['google|model-a']);
            expect(warnings).toHaveLength(3);
            expect(warnings.find((w) => w.includes('openai|model-b'))).toContain('budgetTokens');
            expect(warnings.find((w) => w.includes('wrong-key'))).toContain('openai|model-c');
            expect(warnings.find((w) => w.includes('anthropic|secret'))).toContain('apiKey');
        });

        it('refuses a file written by a newer version instead of misreading it', () => {
            const { state, warnings } = parseModelReasoningPreferences({
                version: MODEL_REASONING_PREFERENCES_VERSION + 1,
                models: { 'google|model-a': { anything: true } },
            });
            expect(state.models).toEqual({});
            expect(warnings[0]).toContain('newer Dexto');
        });

        it('refuses unversioned or non-object content', () => {
            expect(parseModelReasoningPreferences({ models: {} }).warnings[0]).toContain(
                'no integer version'
            );
            expect(parseModelReasoningPreferences([]).warnings[0]).toContain('not a JSON object');
            expect(parseModelReasoningPreferences({ version: 0 }).warnings[0]).toContain(
                'not supported'
            );
        });
    });

    describe('resolveModelReasoningPreference', () => {
        const entry = (reasoning: { variant?: string; budgetTokens?: number } | null) => ({
            ...MODEL_A,
            reasoning,
            updatedAt: '2026-09-12T00:00:00.000Z',
        });

        it('returns undefined when nothing is saved and null for an explicit reset', () => {
            expect(resolveModelReasoningPreference({ entry: null, profile: PROFILE_A })).toEqual({
                reasoning: undefined,
                stale: [],
            });
            expect(
                resolveModelReasoningPreference({ entry: entry(null), profile: PROFILE_A })
            ).toEqual({ reasoning: null, stale: [] });
        });

        it('applies everything the current profile still supports', () => {
            expect(
                resolveModelReasoningPreference({
                    entry: entry({ variant: 'max', budgetTokens: 8192 }),
                    profile: PROFILE_A,
                })
            ).toEqual({ reasoning: { variant: 'max', budgetTokens: 8192 }, stale: [] });
        });

        it('reports a removed variant and keeps the budget', () => {
            const resolved = resolveModelReasoningPreference({
                entry: entry({ variant: 'ultra', budgetTokens: 8192 }),
                profile: PROFILE_A,
            });
            expect(resolved.reasoning).toEqual({ budgetTokens: 8192 });
            expect(resolved.stale).toEqual([
                {
                    field: 'variant',
                    value: 'ultra',
                    reason: 'supported variants are now: disabled, high, max',
                },
            ]);
        });

        it('reports a budget the model does not accept and keeps the variant', () => {
            const resolved = resolveModelReasoningPreference({
                entry: entry({ variant: 'high', budgetTokens: 8192 }),
                profile: PROFILE_B,
            });
            expect(resolved.reasoning).toEqual({ variant: 'high' });
            expect(resolved.stale.map((s) => s.field)).toEqual(['budgetTokens']);
        });

        it('reports everything as stale for a model that lost reasoning support', () => {
            const resolved = resolveModelReasoningPreference({
                entry: entry({ variant: 'high', budgetTokens: 8192 }),
                profile: NON_CAPABLE,
            });
            expect(resolved.reasoning).toBeUndefined();
            expect(resolved.stale.map((s) => s.field)).toEqual(['variant', 'budgetTokens']);
        });
    });
});
