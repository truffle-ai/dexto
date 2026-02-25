import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';

let modelPickerStatePath = '';

vi.mock('./path-resolver.js', () => ({
    getModelPickerStatePath: () => modelPickerStatePath,
}));

import {
    MODEL_PICKER_FAVORITES_LIMIT,
    MODEL_PICKER_RECENTS_LIMIT,
    loadModelPickerState,
    pruneModelPickerState,
    recordRecentModel,
    setFavoriteModels,
    toggleFavoriteModel,
    toModelPickerKey,
} from './model-picker-state.js';

describe('model-picker-state', () => {
    let tempDir = '';

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(tmpdir(), 'dexto-model-picker-state-'));
        modelPickerStatePath = path.join(tempDir, 'model-picker-state.json');
    });

    afterEach(async () => {
        if (tempDir) {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });

    it('returns default state when file does not exist', async () => {
        const state = await loadModelPickerState();
        expect(state.recents).toEqual([]);
        expect(state.favorites).toEqual([]);
    });

    it('records recents with dedupe and cap', async () => {
        for (let i = 0; i < MODEL_PICKER_RECENTS_LIMIT + 2; i += 1) {
            await recordRecentModel({
                provider: 'openai',
                model: `model-${i}`,
            });
        }

        const state = await loadModelPickerState();
        expect(state.recents).toHaveLength(MODEL_PICKER_RECENTS_LIMIT);
        expect(state.recents[0]?.model).toBe(`model-${MODEL_PICKER_RECENTS_LIMIT + 1}`);

        await recordRecentModel({
            provider: 'openai',
            model: 'model-3',
        });

        const updated = await loadModelPickerState();
        const matches = updated.recents.filter((entry) => entry.model === 'model-3');
        expect(matches).toHaveLength(1);
        expect(updated.recents[0]?.model).toBe('model-3');
    });

    it('toggles favorites', async () => {
        const first = await toggleFavoriteModel({
            provider: 'anthropic',
            model: 'claude-sonnet',
        });

        expect(first.isFavorite).toBe(true);
        expect(first.state.favorites).toHaveLength(1);

        const second = await toggleFavoriteModel({
            provider: 'anthropic',
            model: 'claude-sonnet',
        });

        expect(second.isFavorite).toBe(false);
        expect(second.state.favorites).toHaveLength(0);
    });

    it('sets favorites with normalization', async () => {
        const state = await setFavoriteModels({
            favorites: [
                { provider: 'openai', model: 'gpt-5' },
                { provider: 'openai', model: 'gpt-5' },
                { provider: 'google', model: 'gemini-2.5-pro' },
            ],
        });

        expect(state.favorites).toHaveLength(2);
        expect(state.favorites[0]?.provider).toBe('openai');
        expect(state.favorites[0]?.model).toBe('gpt-5');
        expect(state.favorites[1]?.provider).toBe('google');
        expect(state.favorites[1]?.model).toBe('gemini-2.5-pro');
    });

    it('prunes entries that are not allowed', async () => {
        await setFavoriteModels({
            favorites: [
                { provider: 'openai', model: 'gpt-5' },
                { provider: 'google', model: 'gemini-2.5-pro' },
            ],
        });
        await recordRecentModel({ provider: 'openai', model: 'gpt-5' });
        await recordRecentModel({ provider: 'anthropic', model: 'claude-opus-4-5-20251101' });

        const state = await loadModelPickerState();
        const pruned = pruneModelPickerState({
            state,
            allowedKeys: new Set([toModelPickerKey({ provider: 'openai', model: 'gpt-5' })]),
        });

        expect(pruned.recents).toHaveLength(1);
        expect(pruned.favorites).toHaveLength(1);
        expect(pruned.recents[0]?.provider).toBe('openai');
        expect(pruned.favorites[0]?.provider).toBe('openai');
    });

    it('caps favorites when setting a large list', async () => {
        const favorites = Array.from({ length: MODEL_PICKER_FAVORITES_LIMIT + 10 }, (_, index) => ({
            provider: 'openai' as const,
            model: `gpt-5-${index}`,
        }));

        const state = await setFavoriteModels({ favorites });
        expect(state.favorites).toHaveLength(MODEL_PICKER_FAVORITES_LIMIT);
        expect(state.favorites[0]?.model).toBe('gpt-5-0');
        expect(state.favorites[MODEL_PICKER_FAVORITES_LIMIT - 1]?.model).toBe(
            `gpt-5-${MODEL_PICKER_FAVORITES_LIMIT - 1}`
        );
    });
});
