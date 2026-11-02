import { createElement } from 'react';
import { PassThrough } from 'node:stream';
import { render, Text } from 'ink';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TuiAgentBackend } from '../agent-backend.js';
import { dextoCreditBalance } from '../host/index.js';
import { useDextoCreditBalance } from './useDextoCredits.js';

vi.mock('../host/index.js', () => ({
    currentSignIn: vi.fn(),
    dextoCreditBalance: vi.fn(),
}));

const balanceMock = vi.mocked(dextoCreditBalance);
const agent = { on: vi.fn() } as unknown as TuiAgentBackend;
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('useDextoCreditBalance', () => {
    beforeEach(() => balanceMock.mockReset());

    it('refetches when billing recovery closes, keeping the old balance until it arrives', async () => {
        const seen: Array<number | null> = [];
        const Probe = ({ billingOpen }: { billingOpen: boolean }) => {
            seen.push(useDextoCreditBalance(agent, 's1', 'ada', billingOpen));
            return createElement(Text, null, 'x');
        };
        const stdout = Object.assign(new PassThrough(), { columns: 40, rows: 10, isTTY: false });
        const options = {
            stdout: stdout as unknown as NodeJS.WriteStream,
            debug: true,
            patchConsole: false,
            exitOnCtrlC: false,
        };

        balanceMock.mockResolvedValue(0);
        const view = render(createElement(Probe, { billingOpen: true }), options);
        await tick();
        expect(seen.at(-1)).toBe(0);

        balanceMock.mockResolvedValue(25);
        const before = seen.length;
        view.rerender(createElement(Probe, { billingOpen: false }));
        await tick();
        view.unmount();

        expect(seen.slice(before)).not.toContain(null);
        expect(seen.at(-1)).toBe(25);
    });

    it('drops the old balance and refetches when another account signs in', async () => {
        const seen: Array<number | null> = [];
        const Probe = ({ account }: { account: string }) => {
            seen.push(useDextoCreditBalance(agent, 's1', account, false));
            return createElement(Text, null, 'x');
        };
        const stdout = Object.assign(new PassThrough(), { columns: 40, rows: 10, isTTY: false });
        const options = {
            stdout: stdout as unknown as NodeJS.WriteStream,
            debug: true,
            patchConsole: false,
            exitOnCtrlC: false,
        };

        balanceMock.mockResolvedValue(12);
        const view = render(createElement(Probe, { account: 'ada' }), options);
        await tick();
        expect(seen.at(-1)).toBe(12);

        let resolveBalance: (value: number) => void = () => undefined;
        balanceMock.mockReturnValue(
            new Promise<number>((resolve) => {
                resolveBalance = resolve;
            })
        );
        view.rerender(createElement(Probe, { account: 'grace' }));
        await tick();
        expect(seen.at(-1)).toBeNull();

        resolveBalance(5);
        await tick();
        view.unmount();
        expect(seen.at(-1)).toBe(5);
    });
});
