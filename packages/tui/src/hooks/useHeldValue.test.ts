import { createElement } from 'react';
import { PassThrough } from 'node:stream';
import { render, Text } from 'ink';
import { describe, expect, it } from 'vitest';
import { useHeldValue } from './useHeldValue.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('useHeldValue', () => {
    it('keeps the last value while held and catches up on release', async () => {
        const seen: string[] = [];
        const Probe = ({ value, held }: { value: string; held: boolean }) => {
            seen.push(useHeldValue(value, held));
            return createElement(Text, null, 'x');
        };
        const stdout = Object.assign(new PassThrough(), { columns: 40, rows: 10, isTTY: false });
        const view = render(createElement(Probe, { value: '1.0K', held: false }), {
            stdout: stdout as unknown as NodeJS.WriteStream,
            debug: true,
            patchConsole: false,
            exitOnCtrlC: false,
        });
        await tick();

        view.rerender(createElement(Probe, { value: '1.1K', held: true }));
        await tick();
        expect(seen.at(-1)).toBe('1.0K');

        view.rerender(createElement(Probe, { value: '1.2K', held: false }));
        await tick();
        view.unmount();
        expect(seen.at(-1)).toBe('1.2K');
    });
});
