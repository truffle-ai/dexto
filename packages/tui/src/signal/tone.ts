/**
 * Colour roles. Colour is a signal, not decoration: each hue has one job.
 *   teal    the local agent and what you drive (brand #4EC9B0)
 *   cloud   anything that runs on Dexto cloud. No cloud colour means nothing left the machine.
 *   amber   waiting on you (approvals, questions, steer)
 *   red     fault
 *   neutral fg, hi, dim, faint, ghost: everything you read for hours
 * Surfaces (s1, s2, sel, *Bg) are backgrounds.
 */
import { useCallback } from 'react';
import { getCaps, useCaps, type Caps } from './caps.js';

export type Role =
    | 'bg'
    | 'fg'
    | 'hi'
    | 'dim'
    | 'faint'
    | 'ghost'
    | 'teal'
    | 'tealDim'
    | 'cloud'
    | 'cloudDim'
    | 'amber'
    | 'amberDim'
    | 'red'
    | 'redDim'
    | 'add'
    | 'del'
    | 's1'
    | 's2'
    | 'sel'
    | 'addBg'
    | 'addBg2'
    | 'delBg'
    | 'delBg2'
    | 'cloudBg'
    | 'amberBg'
    | 'redBg';

/** Ink colour names for the user's own 16-colour palette (not a nearest match). */
type Ansi16 = 'red' | 'green' | 'yellow' | 'magenta' | 'cyan' | 'gray';

interface RoleSpec {
    dark: string;
    light: string;
    /** null: terminal default foreground, or no background, on 16-colour terminals. */
    ansi16: Ansi16 | null;
}

const ROLES: Readonly<Record<Role, RoleSpec>> = {
    bg: { dark: '#0A0D0E', light: '#F6F7F5', ansi16: null },
    fg: { dark: '#D8E0DE', light: '#1B2221', ansi16: null },
    hi: { dark: '#F4F8F7', light: '#050807', ansi16: null },
    dim: { dark: '#7F8C8A', light: '#5E6A68', ansi16: 'gray' },
    faint: { dark: '#3B4644', light: '#BAC4C1', ansi16: 'gray' },
    ghost: { dark: '#232B2A', light: '#DCE2E0', ansi16: 'gray' },
    teal: { dark: '#4EC9B0', light: '#0B7A68', ansi16: 'cyan' },
    tealDim: { dark: '#2F7F70', light: '#3E8F80', ansi16: 'cyan' },
    cloud: { dark: '#E28DF0', light: '#9E2A9C', ansi16: 'magenta' },
    cloudDim: { dark: '#8A5A93', light: '#C58AC3', ansi16: 'magenta' },
    amber: { dark: '#F4B54A', light: '#955A00', ansi16: 'yellow' },
    amberDim: { dark: '#8C6A2E', light: '#C9A061', ansi16: 'yellow' },
    red: { dark: '#FF6E61', light: '#C2281B', ansi16: 'red' },
    redDim: { dark: '#9A4A43', light: '#D98B83', ansi16: 'red' },
    add: { dark: '#7FDDB0', light: '#16794A', ansi16: 'green' },
    del: { dark: '#FF8F86', light: '#B42318', ansi16: 'red' },
    s1: { dark: '#111618', light: '#ECEFEC', ansi16: null },
    s2: { dark: '#161D1F', light: '#E2E7E4', ansi16: null },
    sel: { dark: '#14302B', light: '#D3ECE6', ansi16: null },
    addBg: { dark: '#0F2620', light: '#DDF3E6', ansi16: null },
    addBg2: { dark: '#18493A', light: '#B5E5C8', ansi16: null },
    delBg: { dark: '#2C1517', light: '#FBE3E0', ansi16: null },
    delBg2: { dark: '#5A2226', light: '#F4BDB6', ansi16: null },
    cloudBg: { dark: '#1E1424', light: '#F6E9F6', ansi16: null },
    amberBg: { dark: '#241B0D', light: '#FBF1DD', ansi16: null },
    redBg: { dark: '#2A1312', light: '#FCE6E3', ansi16: null },
};

/**
 * The Ink colour for a role under the given caps. Returns '' for "terminal default"
 * (16-colour neutrals and surfaces, NO_COLOR); Ink draws '' as no colour.
 * Truecolor and 256 both return hex; chalk reduces hex to the 256 cube itself.
 */
export function resolveTone(role: Role, caps: Caps): string {
    const spec = ROLES[role];
    switch (caps.color) {
        case 'none':
            return '';
        case '16':
            return spec.ansi16 ?? '';
        case '256':
        case 'truecolor':
            return caps.theme === 'light' ? spec.light : spec.dark;
    }
}

/**
 * The Ink colour for a role in this terminal. Use for `color`, `borderColor`, `backgroundColor`.
 * Reads caps once; inside a component prefer `useTone()`, which re-renders when caps change.
 */
export function tone(role: Role): string {
    return resolveTone(role, getCaps());
}

/** `tone` bound to the current caps; the component re-renders when they change (OSC 11, tests). */
export function useTone(): (role: Role) => string {
    const caps = useCaps();
    return useCallback((role: Role) => resolveTone(role, caps), [caps]);
}
