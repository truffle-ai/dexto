import { describe, expect, it, vi } from 'vitest';
import { applyWorkspaceToAgent } from './workspace.js';

describe('applyWorkspaceToAgent', () => {
    it('sets the workspace when none is active', async () => {
        const agent = {
            getWorkspace: vi.fn().mockResolvedValue(undefined),
            setWorkspace: vi.fn().mockResolvedValue(undefined),
        };

        await applyWorkspaceToAgent(agent, '/tmp/dexto-cloud');

        expect(agent.setWorkspace).toHaveBeenCalledWith({
            path: '/tmp/dexto-cloud',
        });
    });

    it('does not reset the workspace when it is already current', async () => {
        const agent = {
            getWorkspace: vi.fn().mockResolvedValue({
                id: 'workspace-1',
                path: '/tmp/dexto-cloud',
                createdAt: 1,
                lastActiveAt: 1,
            }),
            setWorkspace: vi.fn().mockResolvedValue(undefined),
        };

        await applyWorkspaceToAgent(agent, '/tmp/dexto-cloud');

        expect(agent.setWorkspace).not.toHaveBeenCalled();
    });
});
