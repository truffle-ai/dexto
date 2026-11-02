import { createElement, type ReactElement } from 'react';
import { PassThrough } from 'node:stream';
import { render, Text } from 'ink';
import stripAnsi from 'strip-ansi';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCaps, setCaps, type Caps } from './caps.js';
import { Deck, type DeckState } from './components.js';
import { deckLayout, formatTokens } from './deck-layout.js';
import { laneParts, statusRowFit } from './deck-parts.js';

/** A stdout that records each write as it happens. */
function recordingStdout(columns: number) {
    const writes: string[] = [];
    const stdout = Object.assign(new PassThrough(), { columns, rows: 40, isTTY: false });
    stdout.write = ((chunk: unknown) => {
        writes.push(String(chunk));
        return true;
    }) as typeof stdout.write;
    return { stdout: stdout as unknown as NodeJS.WriteStream, writes };
}

async function frame(element: ReactElement, columns: number): Promise<string> {
    const { stdout, writes } = recordingStdout(columns);
    const view = render(element, { stdout, debug: true, patchConsole: false, exitOnCtrlC: false });
    // Let the trace measure itself and draw at its real width.
    await new Promise((resolve) => setTimeout(resolve, 20));
    view.unmount();
    // Debug mode writes the whole frame each time; in CI, unmount adds a lone newline.
    const last = writes.filter((w) => w.trim() !== '').at(-1) ?? '';
    return stripAnsi(last).replace(/\n+$/, '');
}

const state: DeckState = {
    mode: 'stream',
    readout: '84 tok/s · 12.4s',
    status: {
        model: 'dexto/sonnet-5.5',
        contextUsedTokens: 46_000,
        contextMaxTokens: 200_000,
        where: { kind: 'local' },
        branch: 'main',
        dirtyFiles: 3,
        credits: { kind: 'balance', balance: 12.84, spend: null },
    },
};

function deck(s: DeckState = state, gate: ReactElement | null = null) {
    const children = createElement(Text, null, '› ask');
    return createElement(
        Deck,
        gate === null ? { state: s, children } : { state: s, gate, children }
    );
}

describe('deckLayout', () => {
    it('steps down from a status block to a status row to a bare trace', () => {
        expect(deckLayout(120)).toMatchObject({ band: 'wide', bandRows: 3, statusRow: false });
        expect(deckLayout(78)).toMatchObject({ band: 'mid', bandRows: 3, statusRow: true });
        expect(deckLayout(42)).toMatchObject({ band: 'bare', bandRows: 2, statusRow: true });
    });

    it('keeps the deck to four or five rows with a one-line input', () => {
        const rows = (cols: number) => {
            const l = deckLayout(cols);
            return l.bandRows + 1 + (l.statusRow ? 1 : 0);
        };
        expect(rows(120)).toBe(4);
        expect(rows(78)).toBe(5);
        expect(rows(42)).toBe(4);
    });

    it('sizes the status block between 30 and 36 columns', () => {
        expect(deckLayout(100).blockWidth).toBe(30);
        expect(deckLayout(200).blockWidth).toBe(36);
        expect(deckLayout(80).blockWidth).toBe(0);
    });
});

describe('laneParts', () => {
    it('drops the dirty count first, then the branch', () => {
        const status = state.status;
        // "◇ local" 7 + " · ◆ $12.84" 11 + " ⎇ main" 7 + " ±3" 3
        expect(laneParts(status, 28)).toEqual({ branch: true, dirty: true, spend: false });
        expect(laneParts(status, 27)).toEqual({ branch: true, dirty: false, spend: false });
        expect(laneParts(status, 24)).toEqual({ branch: false, dirty: false, spend: false });
    });

    it("drops this turn's spend last", () => {
        const status = {
            ...state.status,
            credits: { kind: 'balance' as const, balance: 12.84, spend: 0.31 },
        };
        // base 18 + " −$0.31" 7
        expect(laneParts(status, 25)).toEqual({ branch: false, dirty: false, spend: true });
        expect(laneParts(status, 24)).toEqual({ branch: false, dirty: false, spend: false });
    });
});

describe('statusRowFit', () => {
    const status = { ...state.status, model: 'dexto/anthropic/claude-sonnet-4.5' };

    it('reserves the lane and lets the model truncate', () => {
        // lane minimum: "◇ local" 7 + " · ◆ $12.84" 11 = 18
        expect(statusRowFit(status, 42, 0)).toEqual({ model: 22, lane: 18 });
    });

    it('hides the model rather than show a stub', () => {
        expect(statusRowFit(status, 42, 19)).toEqual({ model: 0, lane: 23 });
    });

    it('gives the lane whatever the model leaves', () => {
        expect(statusRowFit(state.status, 120, 0)).toEqual({ model: 21, lane: 97 });
    });
});

describe('formatTokens', () => {
    it('reads like 46k, 1.2M and 850', () => {
        expect(formatTokens(46_000)).toBe('46k');
        expect(formatTokens(1_200_000)).toBe('1.2M');
        expect(formatTokens(850)).toBe('850');
    });
});

describe('Deck', () => {
    let saved: Caps;
    beforeEach(() => {
        saved = getCaps();
        setCaps({ ...saved, color: 'none', glyphs: 'unicode', motion: 'reduced' });
    });
    afterEach(() => setCaps(saved));

    it('is four rows at 120 columns, with the status block beside the trace', async () => {
        const out = await frame(deck(), 120);
        const lines = out.split('\n');
        expect(lines).toHaveLength(4);
        expect(lines[0]).toMatch(/STREAMING · 84 tok\/s · 12\.4s\s*$/);
        expect(lines[1]).toMatch(/dexto\/sonnet-5\.5\s+46k\/200k\s*$/);
        expect(lines[2]).toMatch(/◇ local ⎇ main ±3 · ◆ \$12\.84\s*$/);
        expect(lines[3]).toBe('› ask');
    });

    it('moves the status to a compact row under the input below 100 columns', async () => {
        const out = await frame(deck(), 78);
        const lines = out.split('\n');
        expect(lines).toHaveLength(5);
        expect(lines[0]).toMatch(/STREAMING · 84 tok\/s · 12\.4s\s*$/);
        expect(lines[3]).toBe('› ask');
        expect(lines[4]).toMatch(/^dexto\/sonnet-5\.5\s+46k\s+◇ local ⎇ main ±3 · ◆ \$12\.84/);
    });

    it('drops the wordmark below 44 columns and keeps the trace', async () => {
        const out = await frame(deck(), 42);
        const lines = out.split('\n');
        expect(lines).toHaveLength(4);
        expect(out).not.toContain('dexto ');
        expect(lines[0]).toMatch(/[▁-█]/);
        expect(lines[2]).toBe('› ask');
        expect(lines[3]).toMatch(/^84 tok\/s · 12\.4s\s+dex…\s+◇ local · ◆ \$12\.84$/);
    });

    it('keeps the readout, and so the permission mode, in the middle step', async () => {
        const out = await frame(deck({ ...state, mode: 'idle', readout: 'plan mode' }), 78);
        expect(out.split('\n')[0]).toMatch(/READY · plan mode\s*$/);
    });

    it('leads the bare status row with the readout and never cuts the lane', async () => {
        const long = {
            ...state,
            mode: 'idle' as const,
            readout: 'auto-approve',
            status: { ...state.status, model: 'dexto/anthropic/claude-sonnet-4.5' },
        };
        const row = (await frame(deck(long), 42)).split('\n')[3] ?? '';
        expect(row).toMatch(/^auto-approve\s+dexto.*◇ local · ◆ \$12\.84$/);
        const plain = (await frame(deck({ ...long, readout: null }), 42)).split('\n')[3] ?? '';
        expect(plain).toMatch(/^dexto\/anthropic.*…\s+◇ local · ◆ \$12\.84$/);
    });

    it('slots a gate between the band and the input', async () => {
        const out = await frame(deck(state, createElement(Text, null, 'GATE')), 120);
        const lines = out.split('\n');
        expect(lines[3]).toBe('GATE');
        expect(lines[4]).toBe('› ask');
    });

    it('says when you are signed out, out of credits, or on a cloud computer', async () => {
        const signedOut = await frame(
            deck({ ...state, status: { ...state.status, credits: { kind: 'signed-out' } } }),
            120
        );
        expect(signedOut).toContain('· cloud off');
        const loading = await frame(
            deck({ ...state, status: { ...state.status, credits: { kind: 'signed-in' } } }),
            120
        );
        expect(loading).toMatch(/◇ local ⎇ main ±3 · ◆\s*$/m);
        const out = await frame(
            deck({ ...state, status: { ...state.status, credits: { kind: 'out' } } }),
            120
        );
        expect(out).toContain('out of credits');
        const cloud = await frame(
            deck({
                ...state,
                status: { ...state.status, where: { kind: 'computer', name: 'dx-7f3a' } },
            }),
            120
        );
        expect(cloud).toContain('◆ dx-7f3a');
    });

    it('leaves out what it does not know', async () => {
        const out = await frame(
            deck({
                mode: 'idle',
                readout: null,
                status: {
                    ...state.status,
                    model: 'gpt-5',
                    contextUsedTokens: null,
                    contextMaxTokens: null,
                    branch: null,
                    dirtyFiles: 0,
                },
            }),
            120
        );
        const lines = out.split('\n');
        expect(lines[0]).toMatch(/READY\s*$/);
        expect(lines[1]).toMatch(/gpt-5\s*$/);
        expect(lines[2]).toMatch(/◇ local · ◆ \$12\.84\s*$/);
    });

    it('falls back to ASCII glyphs', async () => {
        setCaps({ ...getCaps(), glyphs: 'ascii' });
        const out = await frame(deck(), 120);
        expect(out).toContain('o local @ main +3 . * $12.84');
        expect(out).not.toMatch(/[▁-█◇◆⎇]/);
    });
});

describe('Deck trace clock', () => {
    let saved: Caps;
    beforeEach(() => {
        saved = getCaps();
        setCaps({ ...saved, color: 'none', glyphs: 'unicode', motion: 'full' });
    });
    afterEach(() => setCaps(saved));

    async function framesOver(s: DeckState, ms: number): Promise<number> {
        const { stdout, writes } = recordingStdout(120);
        const view = render(deck(s), {
            stdout,
            debug: true,
            patchConsole: false,
            exitOnCtrlC: false,
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        const settled = writes.length;
        await new Promise((resolve) => setTimeout(resolve, ms));
        const written = writes.length - settled;
        view.unmount();
        return written;
    }

    it('scrolls while the agent works', async () => {
        expect(await framesOver(state, 350)).toBeGreaterThanOrEqual(2);
    });

    it('writes nothing while the session sits idle', async () => {
        expect(await framesOver({ ...state, mode: 'idle', readout: null }, 350)).toBe(0);
    });
});
