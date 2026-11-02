import { describe, expect, it } from 'vitest';
import { cutLines, cutWidth } from './cut.js';

describe('cut type', () => {
    it('draws three rows as wide as cutWidth says', () => {
        const lines = cutLines('Usage 42%');
        expect(lines).toHaveLength(3);
        for (const line of lines) expect([...line]).toHaveLength(cutWidth('Usage 42%'));
    });

    it('keeps the wordmark cuts: open-left D, stemless E', () => {
        expect(cutLines('DE')).toEqual(['▀▀▀▀▄ ▀▀▀▀▀', '    █ ▀▀▀▀ ', '▀▀▀▀  ▀▀▀▀▀']);
    });

    it('draws unknown characters as a space', () => {
        expect(cutWidth('~')).toBe(cutWidth(' '));
    });

    it('is empty for empty text', () => {
        expect(cutWidth('')).toBe(0);
        expect(cutLines('')).toEqual(['', '', '']);
    });
});
