import { describe, expect, it } from 'vitest';
import { getModelDisplayName } from './types';

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
