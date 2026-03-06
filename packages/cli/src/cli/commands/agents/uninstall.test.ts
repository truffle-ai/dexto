import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const getInstalledAgents = vi.fn();
const uninstallAgent = vi.fn();

vi.mock('@dexto/agent-management', () => ({
    getAgentRegistry: vi.fn(() => ({
        getInstalledAgents,
        uninstallAgent,
    })),
}));

vi.mock('../../../analytics/index.js', () => ({
    capture: vi.fn(),
}));

import { handleUninstallCommand } from './uninstall.js';

describe('Uninstall Command', () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleSpy.mockRestore();
        consoleErrorSpy.mockRestore();
    });

    describe('Command validation', () => {
        it('rejects when no agents specified and all flag is false', async () => {
            getInstalledAgents.mockResolvedValue(['some-agent']);

            await expect(handleUninstallCommand([], {})).rejects.toThrow(/No agents specified/);
        });

        it('rejects when no agents are installed', async () => {
            getInstalledAgents.mockResolvedValue([]);

            await expect(handleUninstallCommand(['any-agent'], {})).rejects.toThrow(
                /No agents are currently installed/
            );
            expect(uninstallAgent).not.toHaveBeenCalled();
        });

        it('rejects uninstalling agents that are not installed', async () => {
            getInstalledAgents.mockResolvedValue(['real-agent']);

            await expect(handleUninstallCommand(['fake-agent'], {})).rejects.toThrow(
                /not installed/
            );
        });
    });

    describe('Single agent uninstall', () => {
        it('successfully uninstalls existing agent', async () => {
            getInstalledAgents.mockResolvedValue(['test-agent']);
            uninstallAgent.mockResolvedValue(undefined);

            await expect(handleUninstallCommand(['test-agent'], {})).resolves.not.toThrow();

            expect(uninstallAgent).toHaveBeenCalledWith('test-agent', false);
            expect(consoleSpy).toHaveBeenCalled();
        });

        it('passes through force flag to protected-agent uninstall', async () => {
            getInstalledAgents.mockResolvedValue(['coding-agent']);
            uninstallAgent.mockResolvedValue(undefined);

            await handleUninstallCommand(['coding-agent'], { force: true });

            expect(uninstallAgent).toHaveBeenCalledWith('coding-agent', true);
        });
    });

    describe('Bulk uninstall', () => {
        it('uninstalls all agents when --all flag is used', async () => {
            getInstalledAgents.mockResolvedValue(['agent1', 'agent2', 'agent3']);
            uninstallAgent.mockResolvedValue(undefined);

            await expect(handleUninstallCommand([], { all: true })).resolves.not.toThrow();

            expect(uninstallAgent).toHaveBeenCalledTimes(3);
            expect(uninstallAgent).toHaveBeenCalledWith('agent1', false);
            expect(uninstallAgent).toHaveBeenCalledWith('agent2', false);
            expect(uninstallAgent).toHaveBeenCalledWith('agent3', false);
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('📊 Uninstallation Summary')
            );
        });

        it('uninstalls multiple specified agents', async () => {
            getInstalledAgents.mockResolvedValue(['agent1', 'agent2', 'agent3']);
            uninstallAgent.mockResolvedValue(undefined);

            await handleUninstallCommand(['agent1', 'agent2'], {});

            expect(uninstallAgent).toHaveBeenCalledTimes(2);
            expect(uninstallAgent).toHaveBeenCalledWith('agent1', false);
            expect(uninstallAgent).toHaveBeenCalledWith('agent2', false);
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('📊 Uninstallation Summary')
            );
        });
    });

    describe('Error handling', () => {
        it('continues with other agents when one fails', async () => {
            getInstalledAgents.mockResolvedValue(['good-agent', 'bad-agent']);
            uninstallAgent.mockImplementation((agent: string) => {
                if (agent === 'bad-agent') {
                    throw new Error('Cannot remove protected agent');
                }
                return Promise.resolve(undefined);
            });

            await expect(
                handleUninstallCommand(['good-agent', 'bad-agent'], {})
            ).resolves.not.toThrow();

            expect(uninstallAgent).toHaveBeenCalledTimes(2);
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('📊 Uninstallation Summary')
            );
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Failed to uninstall bad-agent')
            );
        });

        it('throws when single agent uninstall fails', async () => {
            getInstalledAgents.mockResolvedValue(['bad-agent']);
            uninstallAgent.mockRejectedValue(new Error('Protection error'));

            await expect(handleUninstallCommand(['bad-agent'], {})).rejects.toThrow();
        });

        it('shows error in summary when all agents fail in bulk operation', async () => {
            getInstalledAgents.mockResolvedValue(['agent1', 'agent2']);
            uninstallAgent.mockRejectedValue(new Error('Protection error'));

            await expect(handleUninstallCommand(['agent1', 'agent2'], {})).rejects.toThrow(
                /All uninstallations failed/
            );

            expect(uninstallAgent).toHaveBeenCalledTimes(2);
        });

        it('shows partial success when some agents fail in bulk operation', async () => {
            getInstalledAgents.mockResolvedValue(['agent1', 'agent2', 'agent3']);
            uninstallAgent.mockImplementation((agent: string) => {
                if (agent === 'agent2') {
                    throw new Error('Failed to uninstall');
                }
                return Promise.resolve(undefined);
            });

            await expect(
                handleUninstallCommand(['agent1', 'agent2', 'agent3'], {})
            ).resolves.not.toThrow();

            expect(uninstallAgent).toHaveBeenCalledTimes(3);
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('📊 Uninstallation Summary')
            );
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('✅ Successfully'));
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('❌ Failed'));
        });
    });
});
