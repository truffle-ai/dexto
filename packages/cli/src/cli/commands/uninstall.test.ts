import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the agent-helpers module
vi.mock('../../utils/agent-helpers.js', () => ({
    uninstallAgent: vi.fn(),
    listInstalledAgents: vi.fn(),
}));

// Mock analytics
vi.mock('../../analytics/index.js', () => ({
    capture: vi.fn(),
}));

// Import SUT after mocks
import { handleUninstallCommand } from './uninstall.js';
import { uninstallAgent, listInstalledAgents } from '../../utils/agent-helpers.js';

describe('Uninstall Command', () => {
    let consoleSpy: any;
    let consoleErrorSpy: any;

    beforeEach(() => {
        vi.clearAllMocks();

        // Mock console
        consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleSpy.mockRestore();
        consoleErrorSpy.mockRestore();
    });

    describe('Command validation', () => {
        it('rejects when no agents specified and all flag is false', async () => {
            vi.mocked(listInstalledAgents).mockResolvedValue(['some-agent']);

            await expect(handleUninstallCommand([], {})).rejects.toThrow(/No agents specified/);
        });

        it('rejects when no agents are installed', async () => {
            vi.mocked(listInstalledAgents).mockResolvedValue([]);

            await expect(handleUninstallCommand(['any-agent'], {})).rejects.toThrow(
                /No agents are currently installed/
            );
            expect(uninstallAgent).not.toHaveBeenCalled();
        });

        it('rejects uninstalling agents that are not installed', async () => {
            vi.mocked(listInstalledAgents).mockResolvedValue(['real-agent']);

            await expect(handleUninstallCommand(['fake-agent'], {})).rejects.toThrow(
                /not installed/
            );
        });
    });

    describe('Single agent uninstall', () => {
        it('successfully uninstalls existing agent', async () => {
            vi.mocked(listInstalledAgents).mockResolvedValue(['test-agent']);
            vi.mocked(uninstallAgent).mockResolvedValue(undefined);

            await expect(handleUninstallCommand(['test-agent'], {})).resolves.not.toThrow();

            expect(uninstallAgent).toHaveBeenCalledWith('test-agent');
            expect(consoleSpy).toHaveBeenCalled();
        });

        it('uninstalls agent without force flag', async () => {
            vi.mocked(listInstalledAgents).mockResolvedValue(['default-agent']);
            vi.mocked(uninstallAgent).mockResolvedValue(undefined);

            await handleUninstallCommand(['default-agent'], {});

            expect(uninstallAgent).toHaveBeenCalledWith('default-agent');
            expect(uninstallAgent).toHaveBeenCalledTimes(1);
        });
    });

    describe('Bulk uninstall', () => {
        it('uninstalls all agents when --all flag is used', async () => {
            vi.mocked(listInstalledAgents).mockResolvedValue(['agent1', 'agent2', 'agent3']);
            vi.mocked(uninstallAgent).mockResolvedValue(undefined);

            await expect(handleUninstallCommand([], { all: true })).resolves.not.toThrow();

            expect(uninstallAgent).toHaveBeenCalledTimes(3);
            expect(uninstallAgent).toHaveBeenCalledWith('agent1');
            expect(uninstallAgent).toHaveBeenCalledWith('agent2');
            expect(uninstallAgent).toHaveBeenCalledWith('agent3');
            // Multiple agents show summary
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('📊 Uninstallation Summary')
            );
        });

        it('uninstalls multiple specified agents', async () => {
            vi.mocked(listInstalledAgents).mockResolvedValue(['agent1', 'agent2', 'agent3']);
            vi.mocked(uninstallAgent).mockResolvedValue(undefined);

            await handleUninstallCommand(['agent1', 'agent2'], {});

            expect(uninstallAgent).toHaveBeenCalledTimes(2);
            expect(uninstallAgent).toHaveBeenCalledWith('agent1');
            expect(uninstallAgent).toHaveBeenCalledWith('agent2');
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('📊 Uninstallation Summary')
            );
        });
    });

    describe('Error handling', () => {
        it('continues with other agents when one fails', async () => {
            vi.mocked(listInstalledAgents).mockResolvedValue(['good-agent', 'bad-agent']);
            vi.mocked(uninstallAgent).mockImplementation((agent: string) => {
                if (agent === 'bad-agent') {
                    throw new Error('Cannot remove protected agent');
                }
                return Promise.resolve(undefined);
            });

            await expect(
                handleUninstallCommand(['good-agent', 'bad-agent'], {})
            ).resolves.not.toThrow();

            expect(uninstallAgent).toHaveBeenCalledTimes(2);
            // Should show summary for multiple agents
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('📊 Uninstallation Summary')
            );
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Failed to uninstall bad-agent')
            );
        });

        it('throws when single agent uninstall fails', async () => {
            vi.mocked(listInstalledAgents).mockResolvedValue(['bad-agent']);
            vi.mocked(uninstallAgent).mockRejectedValue(new Error('Protection error'));

            // Single agent failure should propagate the error directly
            await expect(handleUninstallCommand(['bad-agent'], {})).rejects.toThrow();
        });

        it('shows error in summary when all agents fail in bulk operation', async () => {
            vi.mocked(listInstalledAgents).mockResolvedValue(['agent1', 'agent2']);
            vi.mocked(uninstallAgent).mockRejectedValue(new Error('Protection error'));

            await expect(handleUninstallCommand(['agent1', 'agent2'], {})).rejects.toThrow(
                /All uninstallations failed/
            );

            expect(uninstallAgent).toHaveBeenCalledTimes(2);
        });

        it('shows partial success when some agents fail in bulk operation', async () => {
            vi.mocked(listInstalledAgents).mockResolvedValue(['agent1', 'agent2', 'agent3']);
            vi.mocked(uninstallAgent).mockImplementation((agent: string) => {
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

    describe('Force flag handling', () => {
        it('accepts force flag in options', async () => {
            vi.mocked(listInstalledAgents).mockResolvedValue(['test-agent']);
            vi.mocked(uninstallAgent).mockResolvedValue(undefined);

            // Force flag is in the options but doesn't affect uninstallAgent call
            await handleUninstallCommand(['test-agent'], { force: true });

            // uninstallAgent only takes agentId, no force parameter
            expect(uninstallAgent).toHaveBeenCalledWith('test-agent');
        });
    });
});
