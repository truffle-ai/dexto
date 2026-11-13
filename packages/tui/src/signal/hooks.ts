/**
 * The React side of caps and tone, kept apart from caps.ts and tone.ts so the string kit
 * (`@dexto/tui/signal-text`) never loads React: commands that print and exit draw without it.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { getCaps, subscribeCaps, type Caps } from './caps.js';
import { resolveTone, type Role } from './tone.js';

/** The caps; the component re-renders when they change (OSC 11, tests). */
export function useCaps(): Caps {
    return useSyncExternalStore(subscribeCaps, getCaps, getCaps);
}

/** `tone` bound to the current caps; the component re-renders when they change (OSC 11, tests). */
export function useTone(): (role: Role) => string {
    const caps = useCaps();
    return useCallback((role: Role) => resolveTone(role, caps), [caps]);
}
