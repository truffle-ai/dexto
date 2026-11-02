import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { getCaps, setCaps, type Caps } from './caps.js';
import {
    BACKGROUND_QUERY,
    createTerminalReplyFilter,
    detectBackgroundTheme,
    parseBackgroundReply,
    queryBackgroundTheme,
    shouldQueryBackground,
    type TerminalIO,
} from './background.js';

const caps: Caps = {
    tty: true,
    color: 'truecolor',
    glyphs: 'unicode',
    logo: 'quadrant',
    theme: 'dark',
    motion: 'full',
    palette: 'signal',
};

const DA1 = '\x1b[?62;22c';

describe('parseBackgroundReply', () => {
    it('reads a dark and a light background, with either terminator', () => {
        expect(parseBackgroundReply('\x1b]11;rgb:1e1e/1e1e/1e1e\x07')).toBe('dark');
        expect(parseBackgroundReply('\x1b]11;rgb:ffff/ffff/ffff\x1b\\')).toBe('light');
    });

    it('accepts one to four hex digits per channel, and rgba', () => {
        expect(parseBackgroundReply('\x1b]11;rgb:f/f/f\x07')).toBe('light');
        expect(parseBackgroundReply('\x1b]11;rgb:fd/f6/e3\x07')).toBe('light');
        expect(parseBackgroundReply('\x1b]11;rgba:0000/2b2b/3636/ffff\x07')).toBe('dark');
    });

    it('weighs green over blue, as the eye does', () => {
        expect(parseBackgroundReply('\x1b]11;rgb:0000/c0c0/0000\x07')).toBe('light');
        expect(parseBackgroundReply('\x1b]11;rgb:0000/0000/ffff\x07')).toBe('dark');
    });

    it('finds the reply among other bytes, and returns null when there is none', () => {
        expect(parseBackgroundReply(`junk\x1b]11;rgb:ffff/ffff/ffff\x07${DA1}`)).toBe('light');
        expect(parseBackgroundReply(DA1)).toBeNull();
        expect(parseBackgroundReply('\x1b]11;rgb:zz/00/00\x07')).toBeNull();
    });
});

describe('shouldQueryBackground', () => {
    it('asks only when the Signal palette will use the answer on a colour TTY', () => {
        expect(shouldQueryBackground(caps, true)).toBe(true);
        expect(shouldQueryBackground({ ...caps, palette: 'legacy' }, true)).toBe(false);
        expect(shouldQueryBackground({ ...caps, color: 'none' }, true)).toBe(false);
        expect(shouldQueryBackground({ ...caps, tty: false }, true)).toBe(false);
        expect(shouldQueryBackground(caps, false)).toBe(false);
    });
});

function fakeTerminal(reply: ((write: string) => string | null) | null) {
    const stdin = Object.assign(new PassThrough(), {
        isTTY: true,
        isRaw: false,
        setRawMode: vi.fn(function (this: { isRaw: boolean }, mode: boolean) {
            this.isRaw = mode;
            return this;
        }),
    });
    const written: string[] = [];
    const stdout = {
        write: (chunk: string) => {
            written.push(chunk);
            const answer = reply?.(chunk) ?? null;
            if (answer !== null) setTimeout(() => stdin.write(answer), 0);
            return true;
        },
    };
    const io: TerminalIO = { stdin, stdout };
    return { io, stdin, written };
}

describe('queryBackgroundTheme', () => {
    it('sends OSC 11 then DA1, and reads the theme from the reply', async () => {
        const { io, written } = fakeTerminal(() => `\x1b]11;rgb:ffff/ffff/ffff\x07${DA1}`);
        await expect(queryBackgroundTheme(io, 500)).resolves.toBe('light');
        expect(written).toEqual([BACKGROUND_QUERY]);
    });

    it('stops at the DA1 reply when the terminal does not answer OSC 11', async () => {
        const { io } = fakeTerminal(() => DA1);
        const started = Date.now();
        await expect(queryBackgroundTheme(io, 5000)).resolves.toBeNull();
        expect(Date.now() - started).toBeLessThan(1000);
    });

    it('gives up after the timeout when nothing answers', async () => {
        const { io } = fakeTerminal(null);
        await expect(queryBackgroundTheme(io, 20)).resolves.toBeNull();
    });

    it('handles a reply split across chunks', async () => {
        const { io, stdin } = fakeTerminal(() => null);
        const pending = queryBackgroundTheme(io, 500);
        stdin.write('\x1b]11;rgb:00');
        stdin.write(`00/0000/0000\x07${DA1}`);
        await expect(pending).resolves.toBe('dark');
    });

    it('puts stdin back as it found it', async () => {
        const { io, stdin } = fakeTerminal(() => DA1);
        await queryBackgroundTheme(io, 500);
        expect(stdin.setRawMode).toHaveBeenLastCalledWith(false);
        expect(stdin.isRaw).toBe(false);
        expect(stdin.listenerCount('data')).toBe(0);
        expect(stdin.isPaused()).toBe(true);
    });
});

describe('detectBackgroundTheme', () => {
    it('updates the caps theme from the reply on the Signal palette', async () => {
        const saved = getCaps();
        setCaps({ ...caps, theme: 'dark' });
        try {
            const { io } = fakeTerminal(() => `\x1b]11;rgb:ffff/ffff/ffff\x07${DA1}`);
            await detectBackgroundTheme(io);
            expect(getCaps().theme).toBe('light');
        } finally {
            setCaps(saved);
        }
    });

    it('sends nothing on the legacy palette', async () => {
        const saved = getCaps();
        setCaps({ ...caps, palette: 'legacy' });
        try {
            const { io, written } = fakeTerminal(() => DA1);
            await detectBackgroundTheme(io);
            expect(written).toEqual([]);
        } finally {
            setCaps(saved);
        }
    });
});

describe('queryBackgroundTheme keeps what the user typed', () => {
    it('hands bytes that are not part of the reply back to stdin', async () => {
        const { io, stdin } = fakeTerminal(
            () => `\x1b]11;rgb:ffff/ffff/ffff\x07summarize this\r${DA1}`
        );
        await expect(queryBackgroundTheme(io, 500)).resolves.toBe('light');
        expect(String(stdin.read())).toBe('summarize this\r');
    });

    it('hands back nothing when only the replies arrived', async () => {
        const { io, stdin } = fakeTerminal(() => `\x1b]11;rgb:ffff/ffff/ffff\x07${DA1}`);
        await queryBackgroundTheme(io, 500);
        expect(stdin.read()).toBeNull();
    });
});

describe('createTerminalReplyFilter', () => {
    const OSC = '\x1b]11;rgb:ffff/ffff/ffff';

    it('drops background and DA1 replies, with either terminator', () => {
        const filter = createTerminalReplyFilter();
        expect(filter(`${OSC}\x07`)).toBe('');
        expect(filter(`${OSC}\x1b\\`)).toBe('');
        expect(filter(DA1)).toBe('');
        expect(filter('\x1b]10;rgb:0/0/0\x07')).toBe('');
    });

    it('keeps the keys around a reply', () => {
        const filter = createTerminalReplyFilter();
        expect(filter(`ab${OSC}\x07cd${DA1}e`)).toBe('abcde');
    });

    it('drops a reply split across chunks', () => {
        const filter = createTerminalReplyFilter();
        expect(filter('x\x1b]11;rgb:ff')).toBe('x');
        expect(filter('ff/ffff/ffff\x07y\x1b[?6')).toBe('y');
        expect(filter('2;22cz')).toBe('z');
    });

    it('passes keyboard escapes through untouched', () => {
        const filter = createTerminalReplyFilter();
        expect(filter('\x1b')).toBe('\x1b');
        expect(filter('\x1b]')).toBe('\x1b]');
        expect(filter('\x1b[')).toBe('\x1b[');
        expect(filter('\x1b[A\x1b[1;5C\x1b[<0;10;5M')).toBe('\x1b[A\x1b[1;5C\x1b[<0;10;5M');
        expect(filter('\x1b]a')).toBe('\x1b]a');
    });

    it('releases held bytes that turn out not to be a reply', () => {
        const filter = createTerminalReplyFilter();
        expect(filter('\x1b]11;rgb')).toBe('');
        expect(filter(' hello')).toBe('\x1b]11;rgb hello');
    });
});
