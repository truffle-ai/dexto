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
    palette: 'signal',
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

    it('gives the pre-Signal colour for every tier on the legacy palette', () => {
        const legacy: Caps = { ...base, palette: 'legacy' };
        expect(resolveTone('dim', legacy)).toBe('gray');
        expect(resolveTone('amber', legacy)).toBe('yellowBright');
        expect(resolveTone('amberDim', legacy)).toBe('yellow');
        expect(resolveTone('teal', { ...legacy, color: 'none' })).toBe('cyan');
        expect(resolveTone('delBg', { ...legacy, color: '16' })).toBe('#662222');
    });

    // The raw colours the TUI used, and the role each one moved to. The legacy palette must give
    // back exactly the original colour, or a screen changes before the Signal look ships.
    it.each([
        ['gray', 'dim'],
        ['white', 'hi'],
        ['cyan', 'teal'],
        ['green', 'add'],
        ['greenBright', 'tealDim'],
        ['red', 'red'],
        ['redBright', 'del'],
        ['yellowBright', 'amber'],
        ['yellow', 'amberDim'],
        ['magenta', 'faint'],
        ['magentaBright', 'cloudDim'],
        ['blue', 'fg'],
        ['black', 'bg'],
        ['gray', 's2'],
        ['#662222', 'delBg'],
        ['#224466', 'addBg'],
        ['#882222', 'delBg2'],
        ['#224488', 'addBg2'],
        ['#3A235A', 'cloudBg'],
        ['#0E3B2E', 's1'],
        ['#1E3B5A', 'sel'],
    ] as const)('legacy %s moved to %s and draws the same', (colour, role) => {
        expect(resolveTone(role, { ...base, palette: 'legacy' })).toBe(colour);
    });

    it('draws no colour under NO_COLOR', () => {
        expect(resolveTone('red', { ...base, color: 'none' })).toBe('');
    });
});
