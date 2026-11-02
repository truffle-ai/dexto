import { describe, expect, it } from 'vitest';
import { detectCaps } from './caps.js';

describe('detectCaps', () => {
    const tty = { TERM: 'xterm-256color', LANG: 'en_US.UTF-8' };

    it('honours NO_COLOR before anything else', () => {
        expect(detectCaps({ ...tty, NO_COLOR: '1', COLORTERM: 'truecolor' }, true).color).toBe(
            'none'
        );
    });

    it('treats an empty NO_COLOR as unset', () => {
        expect(detectCaps({ ...tty, NO_COLOR: '' }, true).color).toBe('256');
    });

    it('draws no colour when stdout is not a TTY', () => {
        expect(detectCaps({ ...tty, COLORTERM: 'truecolor' }, false).color).toBe('none');
    });

    it.each([
        [{ COLORTERM: 'truecolor', TERM: 'xterm' }, 'truecolor'],
        [{ COLORTERM: '24bit', TERM: 'xterm' }, 'truecolor'],
        [{ TERM: 'screen-256color' }, '256'],
        [{ TERM: 'dumb' }, 'none'],
        [{ TERM: 'xterm' }, '16'],
    ] as const)('picks the colour tier from %o', (env, tier) => {
        expect(detectCaps(env, true).color).toBe(tier);
    });

    it('falls back to ASCII glyphs outside a UTF-8 locale', () => {
        expect(detectCaps({ LANG: 'C' }, true).glyphs).toBe('ascii');
        expect(detectCaps({ LC_ALL: 'en_GB.utf8' }, true).glyphs).toBe('unicode');
    });

    it('reads a light background from COLORFGBG', () => {
        expect(detectCaps({ COLORFGBG: '0;15' }, true).theme).toBe('light');
        expect(detectCaps({ COLORFGBG: '15;default;0' }, true).theme).toBe('dark');
        expect(detectCaps({ COLORFGBG: '0;8' }, true).theme).toBe('dark');
        expect(detectCaps({}, true).theme).toBe('dark');
    });

    it('reads 256-colour COLORFGBG backgrounds by their brightness', () => {
        expect(detectCaps({ COLORFGBG: '15;234' }, true).theme).toBe('dark'); // grey ramp, dark
        expect(detectCaps({ COLORFGBG: '0;254' }, true).theme).toBe('light'); // grey ramp, light
        expect(detectCaps({ COLORFGBG: '15;17' }, true).theme).toBe('dark'); // cube, navy
        expect(detectCaps({ COLORFGBG: '0;231' }, true).theme).toBe('light'); // cube, white
        expect(detectCaps({ COLORFGBG: '0;300' }, true).theme).toBe('dark'); // out of range
    });

    it('keeps the legacy palette unless DEXTO_PALETTE=signal', () => {
        expect(detectCaps({}, true).palette).toBe('legacy');
        expect(detectCaps({ DEXTO_PALETTE: 'signal' }, true).palette).toBe('signal');
    });

    it('uses sextants only when asked for on a terminal that draws them', () => {
        expect(detectCaps({ DEXTO_LOGO: 'sextant', TERM_PROGRAM: 'ghostty' }, true).logo).toBe(
            'sextant'
        );
        expect(
            detectCaps({ DEXTO_LOGO: 'sextant', TERM_PROGRAM: 'Apple_Terminal' }, true).logo
        ).toBe('quadrant');
        expect(detectCaps({ TERM_PROGRAM: 'ghostty' }, true).logo).toBe('quadrant');
    });
});
