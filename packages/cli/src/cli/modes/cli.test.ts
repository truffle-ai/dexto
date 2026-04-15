import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MainModeContext } from './context.js';

const applyWorkspaceToAgent = vi.fn();

vi.mock('../../utils/workspace.js', () => ({
    applyWorkspaceToAgent,
}));

vi.mock('../../analytics/wrapper.js', () => ({
    ExitSignal: class ExitSignal extends Error {},
    safeExit: vi.fn(),
}));

describe('runCliMode', () => {
    let runCliMode: typeof import('./cli.js').runCliMode;

    beforeAll(async () => {
        ({ runCliMode } = await import('./cli.js'));
    }, 20_000);

    beforeEach(() => {
        vi.resetModules();
        applyWorkspaceToAgent.mockReset();
    });

    it('stops the agent when workspace application fails after startup', async () => {
        applyWorkspaceToAgent.mockRejectedValue(new Error('workspace sync failed'));

        const agent = {
            start: vi.fn().mockResolvedValue(undefined),
            stop: vi.fn().mockResolvedValue(undefined),
        };

        const context = {
            agent,
            opts: {},
            workspaceRoot: '/tmp/dexto-cloud',
            validatedConfig: {
                permissions: { mode: 'auto' },
                elicitation: { enabled: false },
            },
            resolvedPath: '/tmp/dexto-cloud/agent.yml',
            derivedAgentId: 'coding-agent',
            initialPrompt: undefined,
            getVersionCheckResult: vi.fn().mockResolvedValue(null),
        } as unknown as MainModeContext;

        await expect(runCliMode(context)).rejects.toThrow('workspace sync failed');
        expect(agent.start).toHaveBeenCalledOnce();
        expect(applyWorkspaceToAgent).toHaveBeenCalledWith(agent, '/tmp/dexto-cloud');
        expect(agent.stop).toHaveBeenCalledOnce();
    }, 15_000);
});
