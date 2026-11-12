import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TERMINALS } from '@dexto/tui/signal-harness';
import { getCaps, setCaps } from '@dexto/tui/signal-text';
import {
    browserPromptLines,
    codeRow,
    devicePromptLines,
    signalSignInScreen,
    terminalSignInScreen,
    waitingLine,
} from './sign-in.js';

const CLEAR_LINE = '\r\u001B[2K';

const DEVICE = {
    kind: 'device',
    userCode: 'KX7R-49QD',
    verificationUri: 'https://app.dexto.ai/auth/device',
    verificationUriComplete: null,
    expiresInSeconds: 600,
    organization: 'acme',
    scopes: ['cloud:read', 'sessions:write', 'projects:write'],
    computer: 'sams-laptop',
} as const;

const BROWSER = {
    kind: 'browser',
    authorizeUrl:
        'https://app.dexto.ai/oauth/authorize?client_id=dexto-cli&response_type=code&state=s',
} as const;

describe('signalSignInScreen', () => {
    const savedCaps = getCaps();
    let writes: string[];
    let clock: number;
    const write = (text: string) => writes.push(text);
    const now = () => clock;

    beforeEach(() => {
        // A colour terminal, so richOutput() is true and the waiting line goes live.
        setCaps(TERMINALS['16-dark']);
        vi.useFakeTimers();
        writes = [];
        clock = 1_000;
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        setCaps(savedCaps);
    });

    it('prints the browser prompt, then a waiting line it redraws every 100 ms', () => {
        const screen = signalSignInScreen(write, 120, now);

        screen.show(BROWSER);

        expect(writes).toEqual([
            `${browserPromptLines(BROWSER).join('\n')}\n`,
            `${CLEAR_LINE}${waitingLine(BROWSER, 0, 0)}`,
        ]);

        clock += 2_000;
        vi.advanceTimersByTime(100);
        expect(writes[2]).toBe(`${CLEAR_LINE}${waitingLine(BROWSER, 2_000, 1)}`);
        expect(writes[2]).toContain('waiting for you in the browser');

        screen.settle(false);
        vi.advanceTimersByTime(1_000);
        expect(writes).toHaveLength(4);
    });

    it('counts down a device code, then fades the code in place once signed in', () => {
        const screen = signalSignInScreen(write, 120, now);

        screen.show(DEVICE);

        expect(writes[0]).toBe(`${devicePromptLines(DEVICE).join('\n')}\n`);
        expect(writes[1]).toBe(`${CLEAR_LINE}${waitingLine(DEVICE, 0, 0)}`);
        expect(writes[1]).toContain('expires in');

        screen.settle(true);

        // Up past the blank row, Access and From to the Code row; then back down to this line.
        expect(writes.slice(2)).toEqual([
            CLEAR_LINE,
            `\u001B[4A${CLEAR_LINE}${codeRow(DEVICE.userCode, true)}\n\n\n\n`,
        ]);
    });

    it('leaves the code as it was when the sign-in failed', () => {
        const screen = signalSignInScreen(write, 120, now);
        screen.show(DEVICE);

        screen.settle(false);

        expect(writes.slice(2)).toEqual([CLEAR_LINE]);
    });

    it('gives a terminal narrower than the prompt no live line and no Ctrl-C handler', () => {
        const before = process.listenerCount('SIGINT');
        const screen = signalSignInScreen(write, 20, now);

        screen.show(DEVICE);
        vi.advanceTimersByTime(1_000);

        expect(writes).toEqual([`${devicePromptLines(DEVICE).join('\n')}\n`]);
        expect(process.listenerCount('SIGINT')).toBe(before);
        screen.settle(true);
        expect(writes).toHaveLength(1);
    });

    it('ends the live line on Ctrl-C and exits 130; settling removes the handler', () => {
        const exit = vi
            .spyOn(process, 'exit')
            .mockImplementation((() => undefined) as unknown as typeof process.exit);
        const before = process.listenerCount('SIGINT');
        const screen = signalSignInScreen(write, 120, now);

        screen.show(BROWSER);
        expect(process.listenerCount('SIGINT')).toBe(before + 1);
        // Call the once-wrapper itself: emitting SIGINT would reach the test runner's handlers.
        const onInterrupt = process.rawListeners('SIGINT').at(-1) as () => void;
        onInterrupt();

        expect(writes.at(-1)).toBe(`${CLEAR_LINE}\n`);
        expect(exit).toHaveBeenCalledWith(130);
        expect(process.listenerCount('SIGINT')).toBe(before);
        screen.settle(false);

        screen.show(BROWSER);
        expect(process.listenerCount('SIGINT')).toBe(before + 1);
        screen.settle(true);
        expect(process.listenerCount('SIGINT')).toBe(before);
    });
});

describe('terminalSignInScreen', () => {
    const savedCaps = getCaps();
    const saved = {
        isTTY: Object.getOwnPropertyDescriptor(process.stderr, 'isTTY'),
        columns: Object.getOwnPropertyDescriptor(process.stderr, 'columns'),
    };
    const stderrIs = (isTTY: boolean | undefined, columns: number) => {
        Object.defineProperty(process.stderr, 'isTTY', { value: isTTY, configurable: true });
        Object.defineProperty(process.stderr, 'columns', { value: columns, configurable: true });
    };
    const look = (json: boolean) =>
        terminalSignInScreen(
            () => undefined,
            () => undefined,
            json
        ).look;

    afterEach(() => {
        setCaps(savedCaps);
        for (const [name, descriptor] of Object.entries(saved)) {
            if (descriptor === undefined) Reflect.deleteProperty(process.stderr, name);
            else Object.defineProperty(process.stderr, name, descriptor);
        }
    });

    it('is Signal only at a terminal on Signal, outside JSON', () => {
        setCaps(TERMINALS['16-dark']);
        stderrIs(true, 120);

        expect(look(false)).toBe('signal');
    });

    it('is plain for JSON', () => {
        setCaps(TERMINALS['16-dark']);
        stderrIs(true, 120);

        expect(look(true)).toBe('plain');
    });

    it('is plain while Signal is off', () => {
        setCaps({ ...TERMINALS['16-dark'], palette: 'legacy' });
        stderrIs(true, 120);

        expect(look(false)).toBe('plain');
    });

    it("is plain when stderr isn't a terminal", () => {
        setCaps(TERMINALS['16-dark']);
        stderrIs(false, 120);
        expect(look(false)).toBe('plain');

        stderrIs(undefined, 120);
        expect(look(false)).toBe('plain');
    });
});
