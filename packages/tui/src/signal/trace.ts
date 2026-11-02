/**
 * The trace: the session's activity drawn as a signal that scrolls away from the wordmark.
 * Each column is one sample, taken when it is pushed, so a sample keeps its shape as it ages.
 * A flat line means nothing is happening.
 */
import type { DeckMode } from './components.js';
import type { Role } from './tone.js';

export type TraceKind =
    | 'idle'
    | 'think'
    | 'stream'
    | 'tool'
    | 'cloud'
    | 'wait'
    | 'fault'
    | 'stop'
    | 'flat';

export interface TraceSample {
    kind: TraceKind;
    /** 0 (carrier line) to 1 (full height). */
    amp: number;
}

export interface TraceCell {
    ch: string;
    /** The lower half reuses the upward eighth blocks in reverse video. */
    inverse: boolean;
    kind: TraceKind;
    /** 0 (full colour) to 0.78 (almost background): phosphor persistence. */
    fade: number;
}

const MODE_KIND: Readonly<Record<DeckMode, TraceKind>> = {
    idle: 'idle',
    think: 'think',
    stream: 'stream',
    tool: 'tool',
    cloud: 'cloud',
    wait: 'wait',
    fault: 'fault',
    stop: 'stop',
    steer: 'tool',
    offline: 'idle',
    handoff: 'cloud',
    attached: 'cloud',
    done: 'idle',
};

export const TRACE_ROLE: Readonly<Record<TraceKind, Role>> = {
    idle: 'tealDim',
    think: 'teal',
    stream: 'teal',
    tool: 'teal',
    cloud: 'cloud',
    wait: 'amber',
    fault: 'red',
    stop: 'dim',
    flat: 'faint',
};

/** Kinds that draw only the carrier line: nothing is happening. */
const QUIET: ReadonlySet<TraceKind> = new Set(['idle', 'wait', 'stop', 'flat']);

export function traceKind(mode: DeckMode): TraceKind {
    return MODE_KIND[mode];
}

export function isQuiet(kind: TraceKind): boolean {
    return QUIET.has(kind);
}

/** Deterministic noise in [0, 1). */
function rnd(i: number): number {
    const v = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return v - Math.floor(v);
}

/** Amplitude for the k-th sample of a run of `kind`, at clock tick p. */
function amplitude(kind: TraceKind, k: number, p: number): number {
    switch (kind) {
        case 'idle':
            return 0.04 + 0.05 * (0.5 + 0.5 * Math.sin(p / 14));
        case 'think':
            return 0.18 + 0.22 * (0.5 + 0.5 * Math.sin(p / 6)) * (0.6 + 0.4 * Math.sin(p / 19));
        case 'stream':
            return 0.16 + 0.5 * rnd(p) ** 1.7 * (0.65 + 0.35 * Math.sin(p / 7));
        case 'tool': {
            const gap = 3 + Math.floor(rnd(Math.floor((p + 3) / 7)) * 5);
            return p % gap === 0 ? 0.6 + 0.4 * rnd(p) : p % gap === 1 ? 0.3 : 0.06;
        }
        case 'cloud':
            return 0.3 + 0.45 * Math.abs(Math.sin(p / 4.5)) * (0.6 + 0.4 * rnd(Math.floor(p / 8)));
        case 'fault':
            return k % 9 < 2 ? 1 : 0.15 + 0.6 * rnd(p) ** 2;
        case 'stop':
            return 0.02;
        case 'wait':
        case 'flat':
            return 0;
    }
}

/**
 * Push one sample of `kind` taken at clock `tick`. Newest first; at most `max` samples kept.
 * Smooth kinds ramp in over six columns so a new run doesn't start as a cliff.
 */
export function pushSample(
    history: readonly TraceSample[],
    kind: TraceKind,
    tick: number,
    max: number
): TraceSample[] {
    let run = 0;
    while (run < history.length && history[run]?.kind === kind) run++;
    const ramp = kind === 'tool' || kind === 'fault' ? 1 : Math.min(1, (run + 1) / 6);
    const amp = Math.max(0, Math.min(1, amplitude(kind, run, tick) * ramp));
    return [{ kind, amp }, ...history.slice(0, Math.max(0, max - 1))];
}

const EIGHTHS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;

/**
 * The trace as `height` rows of `width` cells (height even). The upper half grows up from the
 * centre line in eighth blocks; the lower half grows down using the same glyphs in reverse video,
 * so no Unicode 13 "upper eighth" glyphs are needed. Every column draws at least one eighth.
 */
export function traceRows(
    history: readonly TraceSample[],
    width: number,
    height: number
): TraceCell[][] {
    const half = Math.max(1, Math.floor(height / 2));
    const levels = half * 8;
    const fadeFrom = Math.floor(width * 0.35);
    const rows: TraceCell[][] = Array.from({ length: half * 2 }, () => []);
    for (let c = 0; c < width; c++) {
        const sample = history[c] ?? { kind: 'flat' as const, amp: 0 };
        const fade = Math.max(0, (c - fadeFrom) / Math.max(1, width - fadeFrom)) * 0.78;
        const up = Math.max(1, Math.round(sample.amp * levels));
        const down = Math.round(sample.amp * levels * 0.92);
        for (let r = 0; r < half; r++) {
            const u = Math.max(0, Math.min(8, up - r * 8));
            rows[half - 1 - r]?.push({
                ch: EIGHTHS[u] ?? ' ',
                inverse: false,
                kind: sample.kind,
                fade,
            });
            const d = Math.max(0, Math.min(8, down - r * 8));
            const lower =
                d === 8
                    ? { ch: '█', inverse: false }
                    : d > 0
                      ? { ch: EIGHTHS[8 - d] ?? ' ', inverse: true }
                      : { ch: ' ', inverse: false };
            rows[half + r]?.push({ ...lower, kind: sample.kind, fade });
        }
    }
    return rows;
}

function mixHex(from: string, to: string, t: number): string {
    const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
    const out = [0, 1, 2].map((i) =>
        Math.round(channel(from, i) + (channel(to, i) - channel(from, i)) * t)
            .toString(16)
            .padStart(2, '0')
    );
    return `#${out.join('')}`;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * A colour faded toward the background. Only hex colours fade; 16-colour and legacy names
 * stay as they are, since a terminal palette has no in-between shades.
 */
export function fadeColor(color: string, background: string, fade: number): string {
    if (fade <= 0.02 || !HEX.test(color) || !HEX.test(background)) return color;
    return mixHex(color, background, fade);
}
