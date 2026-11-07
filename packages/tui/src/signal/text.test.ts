import { describe, expect, it } from 'vitest';
import { TERMINAL_NAMES, drawText } from './harness.js';
import {
    clock,
    cutRows,
    faultLines,
    forStream,
    letterspaced,
    line,
    link,
    noticeLines,
    safeHref,
    safeText,
    span,
    spread,
    strong,
    wordmarkRows,
} from './text.js';

describe('Signal text from a server', () => {
    const ESC = '\u001B';
    const BEL = '\u0007';
    const C1_CSI = '\u009B';
    const C1_OSC = '\u009D';

    it('takes C0 and C1 control characters out of span text', () => {
        expect(safeText(`Acme${ESC}[2J${ESC}]0;pwned${BEL}`)).toBe('Acme[2J]0;pwned');
        expect(safeText(`Sam${C1_CSI}31m${C1_OSC}8;;http://evil${BEL}`)).toBe(
            'Sam31m8;;http://evil'
        );
        expect(safeText('a\u0000b\u0008c\u007Fd\u0085e')).toBe('abcde');
        expect(safeText('one\ntwo\rthree\tfour')).toBe('one two three four');
        expect(safeText('Acme · ◆ café 日本')).toBe('Acme · ◆ café 日本');
    });

    it.each(TERMINAL_NAMES)('draws no escape of its own from server text on %s', (terminal) => {
        const name = `Acme${ESC}]8;;https://evil.example${BEL}click${ESC}]8;;${BEL}${ESC}[2J\u009B2J`;
        const out = drawText(terminal, () => [
            line([span('fg', name), strong('hi', `${ESC}[?1049h`), link('https://dexto.ai', name)]),
        ]);
        expect(out).not.toContain('evil.example␇');
        expect(out).not.toContain('␛[2J');
        expect(out).not.toContain('␛[?1049h');
        expect(out).not.toContain('\u009B');
        // eslint-disable-next-line no-control-regex
        expect(out).not.toMatch(/[\u0000-\u0006\u0008-\u001A\u001C-\u001F\u007F-\u009F]/u);
    });

    it('links only http and https', () => {
        expect(safeHref('https://app.dexto.ai/auth/device?code=KX7R')).toBe(
            'https://app.dexto.ai/auth/device?code=KX7R'
        );
        expect(safeHref('http://localhost:3000')).toBe('http://localhost:3000');
        for (const href of [
            'javascript:alert(1)',
            'file:///etc/passwd',
            'ssh://evil.example',
            'data:text/html,<script>',
            'not a url',
            '',
            `https://ok.example${BEL}${ESC}]8;;https://evil.example`,
            `https://ok.example/${ESC}\\`,
            `${ESC}]8;;https://evil.example${BEL}`,
            'https://ok.example/\u009D8;;x',
        ])
            expect({ href, safe: safeHref(href) }).toEqual({ href, safe: null });
    });

    it('draws an unsafe link as underlined text with no OSC 8', () => {
        const out = drawText('truecolor-dark', () => [
            line([link('javascript:alert(1)', 'open'), link(`https://x.example${BEL}`, 'two')]),
        ]);
        expect(out).not.toContain('␛]8;;');
        expect(out).toContain('open');
        expect(out).toContain('two');
        expect(drawText('no-color', () => [line([link('file:///etc/passwd')])])).toBe(
            'file:///etc/passwd'
        );
    });
});

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

    it('drops escapes for a stream that is not a terminal', () => {
        const drawn = drawText('truecolor-dark', () => [line([strong('red', 'FAULT')])]);
        expect(drawn).toContain('␛');
        const raw = drawn.replaceAll('␛', '\u001B');
        expect(forStream(false, [raw])).toEqual(['FAULT']);
        expect(forStream(true, [raw])).toEqual([raw]);
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
