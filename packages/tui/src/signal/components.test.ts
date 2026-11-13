import { createElement, type ReactElement } from 'react';
import { PassThrough } from 'node:stream';
import { render, Text } from 'ink';
import stripAnsi from 'strip-ansi';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCaps, setCaps, type Caps } from './caps.js';
import { ActorRow, CutText, Deck, GateFrame, StepRow, Wordmark, type Step } from './components.js';
import { pickWordmark } from './wordmark.js';

function frame(element: ReactElement, columns: number): string {
    const stdout = Object.assign(new PassThrough(), { columns, rows: 40, isTTY: false });
    let output = '';
    stdout.on('data', (chunk) => {
        output += String(chunk);
    });
    const view = render(element, {
        stdout: stdout as unknown as NodeJS.WriteStream,
        debug: true,
        patchConsole: false,
        exitOnCtrlC: false,
    });
    view.unmount();
    stdout.destroy();
    return stripAnsi(output);
}

const step: Step = {
    state: 'wait',
    verb: 'RUN',
    target: 'pnpm db:migrate --env staging',
    detail: '+12 −3',
    time: '0.4s',
    cloud: false,
};

describe('Signal kit parts', () => {
    let saved: Caps;
    beforeEach(() => {
        saved = getCaps();
        setCaps({ ...saved, color: 'none', glyphs: 'unicode', logo: 'quadrant' });
    });
    afterEach(() => setCaps(saved));

    it('Wordmark draws the logo art that fits the rows', () => {
        const out = frame(createElement(Wordmark, { rows: 3 }), 80);
        for (const line of pickWordmark('quadrant', 3).text) expect(out).toContain(line.trimEnd());
    });

    it('Wordmark draws the ASCII art on terminals without UTF-8', () => {
        setCaps({ ...getCaps(), glyphs: 'ascii' });
        const out = frame(createElement(Wordmark, { rows: 4 }), 80);
        for (const line of pickWordmark('ascii', 4).text) expect(out).toContain(line.trimEnd());
    });

    it('CutText draws three rows of half blocks, or the plain word in ASCII', () => {
        expect(frame(createElement(CutText, { text: 'de' }), 80)).toContain('▀▀▀▀▄ ▀▀▀▀▀');
        setCaps({ ...getCaps(), glyphs: 'ascii' });
        expect(frame(createElement(CutText, { text: 'usage' }), 80)).toContain('USAGE');
    });

    it('StepRow lays out verb, target, detail, time and the state word', () => {
        const out = frame(createElement(StepRow, { step }), 100);
        expect(out).toMatch(/▸ RUN\s+pnpm db:migrate --env staging\s+\+12 −3 0\.4s\s+NEEDS YOU/);
    });

    it('StepRow draws ASCII glyphs on terminals without UTF-8', () => {
        setCaps({ ...getCaps(), glyphs: 'ascii' });
        const out = frame(createElement(StepRow, { step: { ...step, state: 'ok' } }), 100);
        expect(out).toMatch(/^\* RUN\s+pnpm db:migrate --env staging\s+\+12 -3 0\.4s/m);
        expect(out).not.toMatch(/[▪▸▫◆−]/);
    });

    it('re-renders mounted parts when caps change', async () => {
        const stdout = Object.assign(new PassThrough(), { columns: 100, rows: 40, isTTY: false });
        let output = '';
        stdout.on('data', (chunk) => {
            output += String(chunk);
        });
        const view = render(createElement(StepRow, { step }), {
            stdout: stdout as unknown as NodeJS.WriteStream,
            debug: true,
            patchConsole: false,
            exitOnCtrlC: false,
        });
        try {
            expect(stripAnsi(output)).toContain('▸ RUN');
            setCaps({ ...getCaps(), glyphs: 'ascii' });
            await vi.waitFor(() => expect(stripAnsi(output)).toContain('> RUN'));
        } finally {
            view.unmount();
            stdout.destroy();
        }
    });

    it('ActorRow puts the actor in the margin, or a glyph when narrow', () => {
        const child = createElement(Text, null, 'hello');
        expect(frame(createElement(ActorRow, { actor: 'agent', children: child }), 80)).toMatch(
            / AGENT\s+hello/
        );
        expect(frame(createElement(ActorRow, { actor: 'you', children: child }), 40)).toMatch(
            /› hello/
        );
    });

    it('GateFrame shows its title, body and hint', () => {
        const out = frame(
            createElement(GateFrame, {
                title: 'NEEDS YOU · RUN A COMMAND',
                hint: 'y once · n deny',
                children: createElement(Text, null, '$ pnpm db:migrate'),
            }),
            80
        );
        expect(out).toContain('NEEDS YOU · RUN A COMMAND');
        expect(out).toContain('$ pnpm db:migrate');
        expect(out).toContain('y once · n deny');
    });

    it('Deck shows the mode, the gate, then the input', () => {
        const out = frame(
            createElement(Deck, {
                collapsed: false,
                paused: false,
                state: {
                    mode: 'wait',
                    readout: 'paused 0:14',
                    status: {
                        model: 'dexto/sonnet-5.5',
                        contextUsedTokens: 46_000,
                        contextMaxTokens: 200_000,
                        where: { kind: 'local' },
                        branch: 'main',
                        dirtyFiles: 3,
                        credits: { kind: 'balance', balance: 1284, spend: null },
                    },
                },
                gate: createElement(Text, null, 'GATE'),
                children: createElement(Text, null, '› input'),
            }),
            100
        );
        expect(out).toContain('NEEDS YOU · paused 0:14');
        expect(out.indexOf('GATE')).toBeLessThan(out.indexOf('› input'));
    });
});
