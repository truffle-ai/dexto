import { describe, expect, it } from 'vitest';
import { TERMINAL_NAMES, drawText } from './harness.js';
import {
    clock,
    cutRows,
    faultLines,
    letterspaced,
    line,
    link,
    noticeLines,
    span,
    spread,
    strong,
    wordmarkRows,
} from './text.js';

describe('Signal text', () => {
    it('draws plain words with no escapes when colour is off', () => {
        const out = drawText('no-color', () => [
            line([
                strong('hi', 'dexto'),
                span('dim', ' 2.0.0 '),
                link('https://dexto.ai/docs/cli'),
            ]),
            ...cutRows('sign in'),
            ...wordmarkRows(6),
        ]);
        expect(out).toBe('dexto 2.0.0 https://dexto.ai/docs/cli\nSIGN IN\ndexto');
    });

    it('wraps links in OSC 8 and keeps the URL as the text', () => {
        const out = drawText('truecolor-dark', () => [
            line([link('https://dexto.ai/device', 'dexto.ai/device')]),
        ]);
        expect(out).toContain('␛]8;;https://dexto.ai/device␇');
        expect(out).toContain('dexto.ai/device');
    });

    it('right-aligns meta on the same row, and drops it to its own row when it does not fit', () => {
        const left = [span('fg', 'Local agent harness.')];
        const right = [span('faint', 'dexto 2.0.0')];
        expect(drawText('no-color', () => spread(left, right, 40))).toBe(
            'Local agent harness.         dexto 2.0.0'
        );
        expect(drawText('no-color', () => spread(left, right, 25))).toBe(
            'Local agent harness.\ndexto 2.0.0'
        );
    });

    it('falls back to ASCII glyphs', () => {
        expect(drawText('ascii', () => [line([span('cloud', '◆ ▪ ▫ ◇')])])).toContain('* * . o');
    });

    it('letterspaces labels and counts time as m:ss', () => {
        expect(letterspaced('preflight')).toBe('P R E F L I G H T');
        expect(clock(581_000)).toBe('9:41');
        expect(clock(6_000)).toBe('0:06');
    });
});

describe.each(TERMINAL_NAMES)('Signal text blocks on %s', (terminal) => {
    it('fault', () => {
        expect(
            drawText(terminal, () =>
                faultLines({
                    message: 'Not signed in.',
                    apiCode: 'unauthorized',
                    details: '{"scope":"drive:read"}',
                    fix: 'dexto login',
                })
            )
        ).toMatchSnapshot();
    });

    it('notice', () => {
        expect(
            drawText(terminal, () =>
                noticeLines('UPDATE', [
                    span('fg', 'dexto 2.2.0 is out · run '),
                    span('teal', 'dexto upgrade'),
                ])
            )
        ).toMatchSnapshot();
    });

    it('cut type', () => {
        expect(drawText(terminal, () => cutRows('sign in'))).toMatchSnapshot();
    });
});
