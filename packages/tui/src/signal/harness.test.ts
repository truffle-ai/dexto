import { createElement, useLayoutEffect, useState } from 'react';
import { Text } from 'ink';
import chalk from 'chalk';
import { describe, expect, it } from 'vitest';
import { getCaps } from './caps.js';
import { TERMINALS, renderFrame } from './harness.js';
import { useTone } from './tone.js';

function Teal() {
    const tone = useTone();
    return createElement(Text, { color: tone('teal') }, 'hi');
}

describe('renderFrame', () => {
    it('returns the frame as plain text on a terminal without colour', () => {
        expect(renderFrame(createElement(Teal), { columns: 40, terminal: 'no-color' })).toBe('hi');
    });

    it('draws each terminal with its own palette, with escapes made visible', () => {
        const frame = (terminal: keyof typeof TERMINALS) =>
            renderFrame(createElement(Teal), { columns: 40, terminal });
        expect(frame('truecolor-dark')).toBe('␛[38;2;78;201;176mhi␛[39m');
        expect(frame('truecolor-light')).toBe('␛[38;2;11;122;104mhi␛[39m');
        expect(frame('256-dark')).toBe('␛[38;5;115mhi␛[39m');
        expect(frame('16-dark')).toBe('␛[36mhi␛[39m');
    });

    it('wraps at the given width', () => {
        const long = createElement(Text, null, 'aaaa bbbb');
        expect(renderFrame(long, { columns: 5, terminal: 'no-color' })).toBe('aaaa\nbbbb');
    });

    it('draws only the settled frame after an update on mount', () => {
        function Settles() {
            const [word, setWord] = useState('first');
            useLayoutEffect(() => setWord('settled'), []);
            return createElement(Text, null, word);
        }
        expect(renderFrame(createElement(Settles), { columns: 40, terminal: 'no-color' })).toBe(
            'settled'
        );
    });

    it('returns an empty frame when an update on mount clears the screen', () => {
        function Clears() {
            const [shown, setShown] = useState(true);
            useLayoutEffect(() => setShown(false), []);
            return shown ? createElement(Text, null, 'first') : null;
        }
        expect(renderFrame(createElement(Clears), { columns: 40, terminal: 'no-color' })).toBe('');
    });

    it('puts the process-wide caps and chalk level back, even when rendering throws', () => {
        const caps = getCaps();
        const level = chalk.level;
        renderFrame(createElement(Teal), { columns: 40, terminal: 'truecolor-light' });
        expect(getCaps()).toBe(caps);
        expect(chalk.level).toBe(level);

        function Throws(): never {
            throw new Error('boom');
        }
        try {
            renderFrame(createElement(Throws), { columns: 40, terminal: 'truecolor-light' });
        } catch {
            // Ink may rethrow or draw its error box; only the restore matters here.
        }
        expect(getCaps()).toBe(caps);
        expect(chalk.level).toBe(level);
    });
});
