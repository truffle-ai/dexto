/**
 * The trace's clock. It pushes one sample per tick while something is happening, and stops once
 * the window holds nothing but carrier line, so an idle session writes nothing to the terminal.
 * With reduced motion it never ticks: each mode change adds a short block instead.
 */
import { useEffect, useRef, useState } from 'react';
import { useCaps } from './caps.js';
import { isQuiet, pushSample, type TraceKind, type TraceSample } from './trace.js';

/** Columns per second the trace scrolls at. */
export const TRACE_RATE = 10;
/** Columns a mode change adds with reduced motion. */
const STEP_COLUMNS = 6;

function windowIsQuiet(history: readonly TraceSample[], width: number): boolean {
    for (let i = 0; i < Math.min(width, history.length); i++) {
        const sample = history[i];
        if (sample !== undefined && !isQuiet(sample.kind)) return false;
    }
    return true;
}

export function useTrace(kind: TraceKind, width: number, paused: boolean): TraceSample[] {
    const { motion } = useCaps();
    const [history, setHistory] = useState<TraceSample[]>([]);
    const tick = useRef(0);
    const kindRef = useRef(kind);
    kindRef.current = kind;
    const maxRef = useRef(Math.max(1, width));
    maxRef.current = Math.max(1, width);

    const settled = isQuiet(kind) && windowIsQuiet(history, width);
    const running = motion === 'full' && !settled && !paused;

    useEffect(() => {
        if (!running) return;
        const timer = setInterval(() => {
            tick.current += 1;
            const at = tick.current;
            setHistory((prev) => pushSample(prev, kindRef.current, at, maxRef.current));
        }, 1000 / TRACE_RATE);
        return () => clearInterval(timer);
    }, [running]);

    useEffect(() => {
        if (motion !== 'reduced') return;
        setHistory((prev) => {
            let next = prev;
            for (let i = 0; i < STEP_COLUMNS; i++) {
                tick.current += 1;
                next = pushSample(next, kind, tick.current, maxRef.current);
            }
            return next;
        });
    }, [motion, kind]);

    return history;
}
