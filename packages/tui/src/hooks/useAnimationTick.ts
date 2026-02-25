import { useSyncExternalStore } from 'react';

const DEFAULT_INTERVAL_MS = 80;

let tick = 0;
let interval: NodeJS.Timeout | null = null;
let intervalMs = DEFAULT_INTERVAL_MS;
const listeners = new Set<() => void>();

function start(): void {
    if (interval) return;
    interval = setInterval(() => {
        tick = (tick + 1) % 1_000_000;
        for (const listener of listeners) listener();
    }, intervalMs);
}

function stop(): void {
    if (!interval) return;
    clearInterval(interval);
    interval = null;
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    start();

    return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
            stop();
        }
    };
}

function getSnapshot(): number {
    return tick;
}

/**
 * Shared animation tick for Ink UI.
 *
 * Motivation: avoid multiple independent timers (spinners, status indicators) that cause
 * out-of-phase redraws and visible flicker.
 */
export function useAnimationTick(options?: { enabled?: boolean; intervalMs?: number }): number {
    const enabled = options?.enabled ?? true;
    const nextIntervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;

    // Keep a single global cadence.
    // If callers disagree, prefer the smallest interval so we don't slow down existing spinners.
    if (nextIntervalMs < intervalMs) {
        intervalMs = nextIntervalMs;
        if (interval) {
            stop();
            start();
        }
    }

    return useSyncExternalStore(enabled ? subscribe : () => () => {}, getSnapshot, getSnapshot);
}
