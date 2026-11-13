/**
 * Snapshot harness for Signal screens: draws an Ink element as one terminal would, to a string.
 * Test-only, so it is not exported from the kit's index.
 *
 *   for (const terminal of TERMINAL_NAMES) {
 *       expect(renderFrame(<StepRow step={step} />, { columns: 100, terminal })).toMatchSnapshot();
 *   }
 *
 * Escapes are kept, with ESC shown as ␛, so a snapshot pins colour as well as layout.
 */
import type { ReactElement } from 'react';
import { PassThrough } from 'node:stream';
import chalk, { type ColorSupportLevel } from 'chalk';
import { render } from 'ink';
import { getCaps, setCaps, type Caps, type ColorTier } from './caps.js';

const BASE: Caps = {
    tty: true,
    color: 'truecolor',
    glyphs: 'unicode',
    logo: 'quadrant',
    theme: 'dark',
    motion: 'reduced',
    palette: 'signal',
};

/** The terminals a screen has to hold up on: the D palette, each colour tier, and ASCII. */
export const TERMINALS = {
    'truecolor-dark': BASE,
    'truecolor-light': { ...BASE, theme: 'light' },
    '256-dark': { ...BASE, color: '256' },
    '16-dark': { ...BASE, color: '16' },
    'no-color': { ...BASE, color: 'none' },
    ascii: { ...BASE, color: '16', glyphs: 'ascii' },
} as const satisfies Readonly<Record<string, Caps>>;

export type TerminalName = keyof typeof TERMINALS;

export const TERMINAL_NAMES = Object.keys(TERMINALS) as TerminalName[];

const CHALK_LEVEL: Readonly<Record<ColorTier, ColorSupportLevel>> = {
    none: 0,
    '16': 1,
    '256': 2,
    truecolor: 3,
};

export interface FrameOptions {
    columns: number;
    terminal: TerminalName;
}

/**
 * What `draw` returns with this terminal's caps and colour level: for screens drawn as strings
 * (`signal/text.ts`) rather than Ink. ESC is shown as ␛, like `renderFrame`.
 */
export function drawText(terminal: TerminalName, draw: () => readonly string[]): string {
    const caps = TERMINALS[terminal];
    const savedCaps = getCaps();
    const savedLevel = chalk.level;
    setCaps(caps);
    chalk.level = CHALK_LEVEL[caps.color];
    try {
        return draw().join('\n').replaceAll('\u001B', '␛').replaceAll('\u0007', '␇');
    } finally {
        chalk.level = savedLevel;
        setCaps(savedCaps);
    }
}

/** `run` with this terminal's caps and colour level until it settles: for async commands. */
export async function onTerminal<T>(terminal: TerminalName, run: () => Promise<T>): Promise<T> {
    const caps = TERMINALS[terminal];
    const savedCaps = getCaps();
    const savedLevel = chalk.level;
    setCaps(caps);
    chalk.level = CHALK_LEVEL[caps.color];
    try {
        return await run();
    } finally {
        chalk.level = savedLevel;
        setCaps(savedCaps);
    }
}

/** The settled frame of `element` on the given terminal, without trailing newlines. */
export function renderFrame(element: ReactElement, { columns, terminal }: FrameOptions): string {
    const caps = TERMINALS[terminal];
    const savedCaps = getCaps();
    const savedLevel = chalk.level;
    // Captured at write: an empty frame is an empty write, which a stream never emits as data.
    const writes: string[] = [];
    const stdout = Object.assign(new PassThrough(), {
        columns,
        rows: 40,
        isTTY: false,
        write: (chunk: unknown) => {
            writes.push(String(chunk));
            return true;
        },
    });
    let frame = '';
    setCaps(caps);
    chalk.level = CHALK_LEVEL[caps.color];
    try {
        const view = render(element, {
            stdout: stdout as unknown as NodeJS.WriteStream,
            debug: true,
            patchConsole: false,
            exitOnCtrlC: false,
        });
        // Debug mode writes each render whole, and unmount renders once more before anything else
        // (under CI, Ink then writes a stray newline). So its first write is the settled frame.
        const settled = writes.length;
        view.unmount();
        frame = writes[settled] ?? '';
    } finally {
        stdout.destroy();
        chalk.level = savedLevel;
        setCaps(savedCaps);
    }
    return frame.replace(/\n+$/, '').replaceAll('\u001B', '␛');
}
