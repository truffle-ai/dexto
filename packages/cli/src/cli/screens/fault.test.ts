import { afterEach, describe, expect, it, vi } from 'vitest';
import { onTerminal, TERMINALS } from '@dexto/tui/signal-harness';
import { getCaps, setCaps } from '@dexto/tui/signal-text';
import { printFault } from './fault.js';

const FAULT = {
    message: 'No API key for anthropic',
    details: 'ANTHROPIC_API_KEY is not set',
    fix: 'export ANTHROPIC_API_KEY=…',
} as const;

const LEGACY = ['❌ No API key for anthropic', 'Set ANTHROPIC_API_KEY'] as const;

describe('printFault', () => {
    const savedCaps = getCaps();
    const savedIsTTY = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');

    const capture = () => {
        const written: string[] = [];
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
            written.push(String(chunk));
            return true;
        });
        return { written, error };
    };
    const stderrIsTTY = (isTTY: boolean) =>
        Object.defineProperty(process.stderr, 'isTTY', { value: isTTY, configurable: true });

    afterEach(() => {
        vi.restoreAllMocks();
        setCaps(savedCaps);
        if (savedIsTTY === undefined) Reflect.deleteProperty(process.stderr, 'isTTY');
        else Object.defineProperty(process.stderr, 'isTTY', savedIsTTY);
    });

    it('prints the legacy lines with console.error while Signal is off', () => {
        setCaps({ ...TERMINALS['16-dark'], palette: 'legacy' });
        const { written, error } = capture();

        printFault(FAULT, LEGACY);

        expect(error.mock.calls).toEqual([[LEGACY[0]], [LEGACY[1]]]);
        expect(written).toEqual([]);
    });

    it("writes the fault block to stderr without escapes when stderr isn't a terminal", async () => {
        stderrIsTTY(false);
        const { written, error } = capture();

        await onTerminal('16-dark', async () => printFault(FAULT, LEGACY));

        expect(error).not.toHaveBeenCalled();
        expect(written).toEqual([
            [
                '  ▌ FAULT   No API key for anthropic',
                '  ▌ details ANTHROPIC_API_KEY is not set',
                '  ▌ next    export ANTHROPIC_API_KEY=…',
            ].join('\n') + '\n',
        ]);
    });

    it('keeps the colour when stderr is a terminal', async () => {
        stderrIsTTY(true);
        const { written } = capture();

        await onTerminal('16-dark', async () => printFault(FAULT, LEGACY));

        expect(written).toHaveLength(1);
        expect(written[0]).toContain('\u001B[');
        expect(written[0]).toContain('FAULT');
    });
});
