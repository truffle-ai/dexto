import { describe, expect, it } from 'vitest';
import type { Caps } from './caps.js';
import { WORDMARK_ART } from './wordmark-art.generated.js';
import { pickWordmark, pulseInk, wordmarkTier, type WordmarkTier } from './wordmark.js';

const caps: Caps = {
    tty: true,
    color: 'truecolor',
    glyphs: 'unicode',
    logo: 'quadrant',
    theme: 'dark',
    motion: 'full',
    palette: 'signal',
};

describe('wordmark art', () => {
    it('has one ink letter per glyph, blank exactly where the glyph is blank', () => {
        for (const tier of Object.keys(WORDMARK_ART) as WordmarkTier[]) {
            for (const art of WORDMARK_ART[tier]) {
                expect(art.text).toHaveLength(art.rows);
                expect(art.ink).toHaveLength(art.rows);
                art.text.forEach((line, r) => {
                    const glyphs = Array.from(line);
                    const ink = art.ink[r] ?? '';
                    expect(glyphs).toHaveLength(art.cols);
                    expect(ink).toHaveLength(art.cols);
                    expect(ink).toMatch(/^[ mfw]*$/);
                    glyphs.forEach((g, c) => expect(g === ' ').toBe(ink[c] === ' '));
                });
            }
        }
    });

    it('lists each tier from shortest to tallest', () => {
        for (const arts of Object.values(WORDMARK_ART)) {
            const heights = arts.map((a) => a.rows);
            expect(heights).toEqual([...heights].sort((a, b) => a - b));
        }
    });
});

describe('wordmarkTier', () => {
    it('uses quadrants by default, sextants when the terminal draws them, ascii without UTF-8', () => {
        expect(wordmarkTier(caps)).toBe('quadrant');
        expect(wordmarkTier({ ...caps, logo: 'sextant' })).toBe('sextant');
        expect(wordmarkTier({ ...caps, logo: 'sextant', glyphs: 'ascii' })).toBe('ascii');
    });
});

describe('pickWordmark', () => {
    it('picks the tallest drawing that fits the rows', () => {
        expect(pickWordmark('quadrant', 3).rows).toBe(3);
        expect(pickWordmark('quadrant', 5).rows).toBe(4);
        expect(pickWordmark('quadrant', 99).rows).toBe(10);
    });

    it('falls back to the shortest drawing when none fits', () => {
        expect(pickWordmark('ascii', 1).rows).toBe(3);
        expect(pickWordmark('sextant', 0).rows).toBe(2);
    });
});

describe('pulseInk', () => {
    const art = pickWordmark('quadrant', 3);

    it('only relights the mark: the word and blanks keep their ink', () => {
        const lit = pulseInk(art, 0.3);
        lit.forEach((line, r) => {
            const base = art.ink[r] ?? '';
            for (let c = 0; c < line.length; c++) {
                if (base[c] === 'm' || base[c] === 'f') expect(line[c]).toMatch(/[mf]/);
                else expect(line[c]).toBe(base[c]);
            }
        });
    });

    it('moves the rings as the phase advances', () => {
        expect(pulseInk(art, 0)).not.toEqual(pulseInk(art, 0.25));
    });
});
