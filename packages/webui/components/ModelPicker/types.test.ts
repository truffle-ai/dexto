import { describe, expect, it } from 'vitest';
import { getModelDisplayName, parseFavoriteKey } from './types';

describe('getModelDisplayName', () => {
    it('prefers displayName when present', () => {
        expect(
            getModelDisplayName({
                name: 'gpt-5',
                displayName: 'GPT 5',
            })
        ).toBe('GPT 5');
    });

    it('falls back to name when displayName is missing', () => {
        expect(
            getModelDisplayName({
                name: 'gpt-5',
            })
        ).toBe('gpt-5');
    });

    it('returns a safe fallback when both labels are missing', () => {
        expect(getModelDisplayName({})).toBe('Unknown model');
    });
});

describe('parseFavoriteKey', () => {
    it('parses provider and model keys', () => {
        expect(parseFavoriteKey('openai|gpt-5')).toEqual({
            provider: 'openai',
            model: 'gpt-5',
        });
    });

    it('preserves optional baseURL segments for custom models', () => {
        expect(parseFavoriteKey('openai-compatible|my-model|https://example.com/v1')).toEqual({
            provider: 'openai-compatible',
            model: 'my-model',
            baseURL: 'https://example.com/v1',
        });
    });

    it('returns null for invalid favorite keys', () => {
        expect(parseFavoriteKey('openai|')).toBeNull();
    });
});
