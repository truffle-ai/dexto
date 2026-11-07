import chalk from 'chalk';
import { afterEach, describe, expect, it } from 'vitest';
import { TERMINALS } from './harness.js';
import { capsFor, drawOn, getCaps, line, richOutput, setCaps, strong } from './text.js';

describe('caps for another stream', () => {
    const saved = getCaps();
    const savedLevel = chalk.level;
    afterEach(() => {
        setCaps(saved);
        chalk.level = savedLevel;
    });

    it("take colour and TTY from that stream, the rest from this terminal's caps", () => {
        setCaps({ ...TERMINALS['truecolor-light'], tty: false, color: 'none' });
        const piped = capsFor({ isTTY: false });
        expect(piped).toMatchObject({ tty: false, color: 'none', theme: 'light' });
        const terminal = capsFor({ isTTY: true });
        expect(terminal.tty).toBe(true);
        expect(terminal.theme).toBe('light');
    });

    it('draw with those caps and chalk level, then put both back', () => {
        setCaps(TERMINALS['no-color']);
        chalk.level = 0;
        const drawn = drawOn(TERMINALS['16-dark'], () => [
            richOutput(),
            line([strong('red', 'FAULT')]),
        ]);
        expect(drawn[0]).toBe(true);
        expect(drawn[1]).toContain('\u001B[');
        expect(getCaps()).toEqual(TERMINALS['no-color']);
        expect(chalk.level).toBe(0);
        expect(line([strong('red', 'FAULT')])).toBe('FAULT');
    });

    it('put the caps back when drawing throws', () => {
        setCaps(TERMINALS['no-color']);
        expect(() =>
            drawOn(TERMINALS['16-dark'], () => {
                throw new Error('boom');
            })
        ).toThrow('boom');
        expect(getCaps()).toEqual(TERMINALS['no-color']);
    });
});
