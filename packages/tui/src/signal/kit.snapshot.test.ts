import { createElement, type ReactElement } from 'react';
import { Text } from 'ink';
import { describe, expect, it } from 'vitest';
import { ActorRow, CutText, GateFrame, StepRow, Wordmark, type Step } from './components.js';
import { TERMINAL_NAMES, renderFrame } from './harness.js';

const STEP: Step = {
    state: 'ok',
    verb: 'EDIT',
    target: 'packages/tui/src/signal/tone.ts',
    detail: '+12 −3',
    time: '0.4s',
    cloud: false,
};

const PARTS: Readonly<Record<string, ReactElement>> = {
    'Wordmark rows=1': createElement(Wordmark, { rows: 1 }),
    'Wordmark rows=4': createElement(Wordmark, { rows: 4 }),
    CutText: createElement(CutText, { text: 'usage' }),
    'ActorRow agent': createElement(ActorRow, {
        actor: 'agent',
        children: createElement(Text, null, 'Fixed the auth tests.'),
    }),
    'ActorRow cloud': createElement(ActorRow, {
        actor: 'cloud',
        label: 'nightly',
        children: createElement(Text, null, 'Running on a Dexto computer.'),
    }),
    'StepRow ok': createElement(StepRow, { step: STEP }),
    'StepRow fail': createElement(StepRow, { step: { ...STEP, state: 'fail', detail: null } }),
    'StepRow wait': createElement(StepRow, { step: { ...STEP, state: 'wait', time: null } }),
    'StepRow cloud': createElement(StepRow, { step: { ...STEP, cloud: true } }),
    GateFrame: createElement(GateFrame, {
        title: 'NEEDS YOU · RUN A COMMAND',
        hint: '⏎ approve · esc deny',
        children: createElement(Text, null, 'pnpm db:migrate --env staging'),
    }),
};

describe('ActorRow margin', () => {
    it('keeps a gap between a label that fills the margin and the text', () => {
        const row = createElement(ActorRow, {
            actor: 'cloud',
            label: 'nightly',
            children: createElement(Text, null, 'Running'),
        });
        const out = renderFrame(row, { columns: 100, terminal: 'no-color' });
        expect(out).toMatch(/^ \S+ Running$/);
    });
});

describe.each(TERMINAL_NAMES)('Signal kit on %s', (terminal) => {
    describe.each([100, 40])('at %i columns', (columns) => {
        it.each(Object.keys(PARTS))('%s', (name) => {
            const part = PARTS[name] as ReactElement;
            expect(renderFrame(part, { columns, terminal })).toMatchSnapshot();
        });
    });
});
