/**
 * Terminal capabilities for the Signal look.
 *
 * Detection order:
 *   colour: NO_COLOR → none · not a TTY → none · COLORTERM truecolor|24bit → truecolor ·
 *           TERM *256color → 256 · TERM dumb → none · otherwise 16
 *   glyphs: UTF-8 locale → unicode, else ascii
 *   logo:   quadrants everywhere; sextants only when asked for (DEXTO_LOGO=sextant) on a
 *           terminal that draws them itself
 *   theme:  COLORFGBG when set, else dark. The OSC 11 background query refines this at start-up
 *           through `setCaps`.
 *   palette: legacy (the pre-Signal colours) unless DEXTO_PALETTE=signal. Signal becomes the
 *           default when the new screens ship.
 *
 * Caps are process-wide: one terminal, one answer. `useCaps()` re-renders when they change.
 */
import { useSyncExternalStore } from 'react';

export type ColorTier = 'truecolor' | '256' | '16' | 'none';
export type GlyphTier = 'unicode' | 'ascii';
export type LogoTier = 'sextant' | 'quadrant';
export type ThemeName = 'dark' | 'light';
export type Motion = 'full' | 'reduced';
export type Palette = 'legacy' | 'signal';

export interface Caps {
    tty: boolean;
    color: ColorTier;
    glyphs: GlyphTier;
    logo: LogoTier;
    theme: ThemeName;
    motion: Motion;
    palette: Palette;
}

type Env = Readonly<Record<string, string | undefined>>;

const SEXTANT_TERMS = new Set([
    'ghostty',
    'WezTerm',
    'vscode',
    'kitty',
    'foot',
    'WindowsTerminal',
    'rio',
]);

function detectColor(env: Env, tty: boolean): ColorTier {
    if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return 'none';
    if (!tty) return 'none';
    if (/^(truecolor|24bit)$/i.test(env.COLORTERM ?? '')) return 'truecolor';
    if (/256color/.test(env.TERM ?? '')) return '256';
    if (env.TERM === 'dumb') return 'none';
    return '16';
}

function terminalProgram(env: Env): string {
    if (env.TERM_PROGRAM) return env.TERM_PROGRAM;
    if (env.TERM === 'xterm-kitty') return 'kitty';
    if (env.WT_SESSION) return 'WindowsTerminal';
    return '';
}

/** Whether an xterm-256 colour index is a light colour. */
function isLightIndex(index: number): boolean {
    // 0–15: the user's palette; white (7) and the bright colours other than grey (8) read light.
    if (index < 16) return index === 7 || index >= 9;
    // 232–255: the grey ramp, 8 to 238 in steps of 10.
    if (index >= 232) return 8 + (index - 232) * 10 >= 128;
    // 16–231: the 6×6×6 cube; levels 0, 95, 135, 175, 215, 255.
    const level = (n: number) => (n === 0 ? 0 : 55 + n * 40);
    const i = index - 16;
    const [r, g, b] = [level(Math.floor(i / 36)), level(Math.floor(i / 6) % 6), level(i % 6)];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b >= 128;
}

/** COLORFGBG is "fg;bg" (sometimes "fg;default;bg"); bg is an xterm-256 index. */
function themeFromColorFgBg(value: string | undefined): ThemeName {
    const bg = Number(value?.split(';').pop());
    return Number.isInteger(bg) && bg >= 0 && bg <= 255 && isLightIndex(bg) ? 'light' : 'dark';
}

export function detectCaps(env: Env, isTTY: boolean): Caps {
    const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || 'en_US.UTF-8';
    return {
        tty: isTTY,
        color: detectColor(env, isTTY),
        glyphs: /utf-?8/i.test(locale) ? 'unicode' : 'ascii',
        logo:
            env.DEXTO_LOGO === 'sextant' && SEXTANT_TERMS.has(terminalProgram(env))
                ? 'sextant'
                : 'quadrant',
        theme: themeFromColorFgBg(env.COLORFGBG),
        motion: env.DEXTO_MOTION === 'reduced' ? 'reduced' : 'full',
        palette: env.DEXTO_PALETTE === 'signal' ? 'signal' : 'legacy',
    };
}

let current: Caps | null = null;
const listeners = new Set<() => void>();

export function getCaps(): Caps {
    if (current === null) current = detectCaps(process.env, process.stdout.isTTY === true);
    return current;
}

/** Replace the process-wide caps (OSC 11 result, user override, tests). */
export function setCaps(next: Caps): void {
    current = next;
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function useCaps(): Caps {
    return useSyncExternalStore(subscribe, getCaps, getCaps);
}
