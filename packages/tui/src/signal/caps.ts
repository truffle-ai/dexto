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
 *
 * Caps are process-wide: one terminal, one answer. `useCaps()` re-renders when they change.
 */
import { useSyncExternalStore } from 'react';

export type ColorTier = 'truecolor' | '256' | '16' | 'none';
export type GlyphTier = 'unicode' | 'ascii';
export type LogoTier = 'sextant' | 'quadrant';
export type ThemeName = 'dark' | 'light';
export type Motion = 'full' | 'reduced';

export interface Caps {
    tty: boolean;
    color: ColorTier;
    glyphs: GlyphTier;
    logo: LogoTier;
    theme: ThemeName;
    motion: Motion;
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

/** COLORFGBG is "fg;bg" (sometimes "fg;default;bg"); a light background is 7 or 9–15. */
function themeFromColorFgBg(value: string | undefined): ThemeName {
    const bg = Number(value?.split(';').pop());
    return Number.isInteger(bg) && bg >= 7 && bg !== 8 ? 'light' : 'dark';
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
