import { describe, expect, it } from 'vitest';
import { getCuratedModelsForProvider } from './curation.js';
import { LLM_REGISTRY } from './registry.js';
import { CURATED_MODEL_IDS_BY_PROVIDER } from './curation-config.js';
import type { LLMProvider } from './types.js';

describe('getCuratedModelsForProvider', () => {
    it('returns an explicit curated list in configured order when available', () => {
        const provider: LLMProvider = 'openai';
        const curated = getCuratedModelsForProvider(provider);

        const expectedPrefix = (CURATED_MODEL_IDS_BY_PROVIDER[provider] ?? []).slice(0, 3);
        expect(expectedPrefix.length).toBeGreaterThan(0);
        expect(curated.slice(0, expectedPrefix.length).map((m) => m.name)).toEqual(expectedPrefix);
    });

    it('does not return an empty list for providers with models', () => {
        const provider: LLMProvider = 'anthropic';
        const curated = getCuratedModelsForProvider(provider);
        expect(curated.length).toBeGreaterThan(0);
    });

    it('curation config references only models that exist in the registry', () => {
        for (const [provider, ids] of Object.entries(CURATED_MODEL_IDS_BY_PROVIDER) as Array<
            [LLMProvider, string[]]
        >) {
            const registryModels = LLM_REGISTRY[provider].models.map((m) => m.name.toLowerCase());
            const registrySet = new Set(registryModels);

            const lowerIds = ids.map((id) => id.toLowerCase());
            expect(new Set(lowerIds).size).toBe(lowerIds.length);

            const missing = lowerIds.filter((id) => !registrySet.has(id));
            expect(missing).toEqual([]);
        }
    });
});
