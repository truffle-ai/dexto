import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    handleTraceCommand: vi.fn(),
    handleTraceListCommand: vi.fn(),
    handleTraceViewCommand: vi.fn(),
    safeExit: vi.fn(),
    writeErr: vi.fn(),
    writeOut: vi.fn(),
}));

vi.mock('../../../analytics/wrapper.js', () => ({
    ExitSignal: class ExitSignal extends Error {},
    safeExit: mocks.safeExit,
    withAnalytics: (_commandName: string, handler: (...args: unknown[]) => unknown) => handler,
}));

vi.mock('./index.js', () => ({
    handleTraceCommand: mocks.handleTraceCommand,
    handleTraceListCommand: mocks.handleTraceListCommand,
    handleTraceViewCommand: mocks.handleTraceViewCommand,
}));

import { registerTraceCommand } from './register.js';

function createProgram(): Command {
    const program = new Command();
    program.exitOverride();
    program.configureOutput({
        writeErr: mocks.writeErr,
        writeOut: mocks.writeOut,
    });
    registerTraceCommand({ program });
    return program;
}

describe('registerTraceCommand', () => {
    beforeEach(() => {
        mocks.handleTraceCommand.mockReset();
        mocks.handleTraceListCommand.mockReset();
        mocks.handleTraceViewCommand.mockReset();
        mocks.safeExit.mockReset();
        mocks.writeErr.mockReset();
        mocks.writeOut.mockReset();
    });

    it('dispatches trace list instead of treating list as a run id', async () => {
        await createProgram().parseAsync(['node', 'dexto', 'trace', 'list', '--limit', '5']);

        expect(mocks.handleTraceListCommand).toHaveBeenCalledWith(
            expect.objectContaining({
                limit: '5',
            })
        );
        expect(mocks.handleTraceCommand).not.toHaveBeenCalled();
        expect(mocks.safeExit).toHaveBeenCalledWith('trace:list', 0);
    });

    it('dispatches explicit trace view', async () => {
        await createProgram().parseAsync(['node', 'dexto', 'trace', 'view', 'run_123', '--json']);

        expect(mocks.handleTraceViewCommand).toHaveBeenCalledWith(
            'run_123',
            expect.objectContaining({
                json: true,
            })
        );
        expect(mocks.handleTraceCommand).not.toHaveBeenCalled();
        expect(mocks.safeExit).toHaveBeenCalledWith('trace:view', 0);
    });

    it('keeps the legacy trace run id shortcut', async () => {
        await createProgram().parseAsync(['node', 'dexto', 'trace', 'run_123', '--json']);

        expect(mocks.handleTraceCommand).toHaveBeenCalledWith(
            'run_123',
            expect.objectContaining({
                json: true,
            })
        );
        expect(mocks.handleTraceViewCommand).not.toHaveBeenCalled();
        expect(mocks.safeExit).toHaveBeenCalledWith('trace', 0);
    });
});
