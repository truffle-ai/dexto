import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    handleSpanListCommand: vi.fn(),
    safeExit: vi.fn(),
    writeErr: vi.fn(),
    writeOut: vi.fn(),
}));

vi.mock('../../../analytics/wrapper.js', () => ({
    ExitSignal: class ExitSignal extends Error {},
    safeExit: mocks.safeExit,
    withAnalytics: (_commandName: string, handler: (...args: unknown[]) => unknown) => handler,
}));

vi.mock('../trace/index.js', () => ({
    handleSpanListCommand: mocks.handleSpanListCommand,
}));

import { registerSpanCommand } from './register.js';

function createProgram(): Command {
    const program = new Command();
    program.exitOverride();
    program.configureOutput({
        writeErr: mocks.writeErr,
        writeOut: mocks.writeOut,
    });
    registerSpanCommand({ program });
    return program;
}

describe('registerSpanCommand', () => {
    beforeEach(() => {
        mocks.handleSpanListCommand.mockReset();
        mocks.safeExit.mockReset();
        mocks.writeErr.mockReset();
        mocks.writeOut.mockReset();
    });

    it('dispatches span list with filters', async () => {
        await createProgram().parseAsync([
            'node',
            'dexto',
            'span',
            'list',
            'run_123',
            '--name',
            'llm.stream',
            '--sort',
            'duration',
        ]);

        expect(mocks.handleSpanListCommand).toHaveBeenCalledWith(
            'run_123',
            expect.objectContaining({
                name: 'llm.stream',
                sort: 'duration',
            })
        );
        expect(mocks.safeExit).toHaveBeenCalledWith('span:list', 0);
    });
});
