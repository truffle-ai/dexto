import { createElement } from 'react';
import { PassThrough } from 'node:stream';
import { render, Text } from 'ink';
import { describe, expect, it } from 'vitest';
import { useElapsedTime } from './useElapsedTime.js';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('useElapsedTime', () => {
    it('holds the value while paused, then carries on from the real start', async () => {
        const seen: number[] = [];
        const Probe = ({ paused }: { paused: boolean }) => {
            seen.push(useElapsedTime({ isActive: true, intervalMs: 10, paused }).elapsedMs);
            return createElement(Text, null, 'x');
        };
        const stdout = Object.assign(new PassThrough(), { columns: 40, rows: 10, isTTY: false });
        const view = render(createElement(Probe, { paused: false }), {
            stdout: stdout as unknown as NodeJS.WriteStream,
            debug: true,
            patchConsole: false,
            exitOnCtrlC: false,
        });
        await wait(60);
        view.rerender(createElement(Probe, { paused: true }));
        await wait(20);
        const held = seen.at(-1) ?? 0;
        const renders = seen.length;
        expect(held).toBeGreaterThan(0);

        await wait(60);
        expect(seen.length).toBe(renders);

        view.rerender(createElement(Probe, { paused: false }));
        await wait(40);
        view.unmount();
        expect(seen.at(-1) ?? 0).toBeGreaterThanOrEqual(held + 60);
    });
});
