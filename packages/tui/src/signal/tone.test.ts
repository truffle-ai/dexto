import { describe, expect, it } from 'vitest';
import type { Caps } from './caps.js';
import { resolveTone } from './tone.js';

const base: Caps = {
    tty: true,
    color: 'truecolor',
    glyphs: 'unicode',
    logo: 'quadrant',
    theme: 'dark',
    motion: 'full',
};

describe('resolveTone', () => {
    it('gives the dark and light hex for each theme', () => {
        expect(resolveTone('teal', base)).toBe('#4EC9B0');
        expect(resolveTone('teal', { ...base, theme: 'light' })).toBe('#0B7A68');
    });

    it('keeps hex on 256-colour terminals', () => {
        expect(resolveTone('cloud', { ...base, color: '256' })).toBe('#E28DF0');
    });

    it("maps to the user's own palette on 16-colour terminals", () => {
        const caps: Caps = { ...base, color: '16' };
        expect(resolveTone('teal', caps)).toBe('cyan');
        expect(resolveTone('cloud', caps)).toBe('magenta');
        expect(resolveTone('amber', caps)).toBe('yellow');
        expect(resolveTone('red', caps)).toBe('red');
        expect(resolveTone('dim', caps)).toBe('gray');
    });

    it('leaves neutrals and surfaces to the terminal default on 16 colours', () => {
        const caps: Caps = { ...base, color: '16' };
        expect(resolveTone('fg', caps)).toBe('');
        expect(resolveTone('amberBg', caps)).toBe('');
    });

    it('draws no colour under NO_COLOR', () => {
        expect(resolveTone('red', { ...base, color: 'none' })).toBe('');
    });
});
