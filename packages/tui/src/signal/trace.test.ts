import { describe, expect, it } from 'vitest';
import { pushSample, traceKind, traceRows, type TraceSample } from './trace.js';

function history(kind: TraceSample['kind'], count: number): TraceSample[] {
    let out: TraceSample[] = [];
    for (let i = 0; i < count; i++) out = pushSample(out, kind, i, 200);
    return out;
}

describe('trace', () => {
    it('maps every deck mode to a trace kind', () => {
        expect(traceKind('idle')).toBe('idle');
        expect(traceKind('stream')).toBe('stream');
        expect(traceKind('steer')).toBe('tool');
        expect(traceKind('attached')).toBe('cloud');
        expect(traceKind('done')).toBe('idle');
    });

    it('keeps newest samples first and caps the history', () => {
        const h = pushSample(history('idle', 5), 'fault', 5, 4);
        expect(h).toHaveLength(4);
        expect(h[0]?.kind).toBe('fault');
    });

    it('draws a waiting or stopped trace as a one-eighth carrier line', () => {
        const rows = traceRows(history('wait', 10), 6, 2);
        expect(rows[0]?.map((c) => c.ch).join('')).toBe('▁▁▁▁▁▁');
        expect(rows[1]?.map((c) => c.ch).join('')).toBe('      ');
    });

    it('fills columns with no history with a flat line', () => {
        const rows = traceRows([], 3, 2);
        expect(rows[0]?.map((c) => c.kind)).toEqual(['flat', 'flat', 'flat']);
    });

    it('mirrors activity below the centre line in reverse video', () => {
        const rows = traceRows(history('fault', 30), 30, 2);
        const lower = rows[1] ?? [];
        expect(lower.some((c) => c.ch !== ' ')).toBe(true);
        expect(lower.filter((c) => c.ch !== ' ' && c.ch !== '█').every((c) => c.inverse)).toBe(
            true
        );
    });

    it('fades older columns toward the background', () => {
        const rows = traceRows(history('stream', 40), 40, 2);
        const fades = (rows[0] ?? []).map((c) => c.fade);
        expect(fades[0]).toBe(0);
        expect(fades[39]).toBeGreaterThan(0.7);
    });

    it('keeps a sample the same as it scrolls', () => {
        const a = history('stream', 20);
        const b = pushSample(a, 'stream', 20, 200);
        expect(b[1]).toEqual(a[0]);
    });
});
