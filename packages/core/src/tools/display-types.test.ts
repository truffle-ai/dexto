import { describe, expect, it } from 'vitest';
import { isValidDisplayData } from './display-types.js';

describe('isValidDisplayData', () => {
    it('accepts complete structured display data', () => {
        expect(
            isValidDisplayData({
                type: 'diff',
                unified: '--- a/config.json\n+++ b/config.json',
                filename: 'config.json',
                additions: 1,
                deletions: 1,
            })
        ).toBe(true);
    });

    it('rejects a display discriminator without the fields its renderer requires', () => {
        expect(isValidDisplayData({ type: 'diff' })).toBe(false);
        expect(isValidDisplayData({ type: 'shell', command: 'pnpm test' })).toBe(false);
        expect(isValidDisplayData({ type: 'file', path: 'config.json' })).toBe(false);
    });
});
