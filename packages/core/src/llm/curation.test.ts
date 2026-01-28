import { describe, expect, it } from 'vitest';
import { getCuratedModelsForProvider } from './curation.js';
import { getDefaultModelForProvider } from './registry.js';
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

    it('fallback selection includes the provider default when no explicit curated list exists', () => {
        const provider: LLMProvider = 'dexto'; // intentionally not present in CURATED_MODEL_IDS_BY_PROVIDER
        const curated = getCuratedModelsForProvider(provider);
        const defaultModel = getDefaultModelForProvider(provider);
        expect(defaultModel).not.toBeNull();
        expect(curated.some((m) => m.name === defaultModel)).toBe(true);
    });
});
