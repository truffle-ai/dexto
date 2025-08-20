import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleUninstallCommand } from './uninstall.js';

// Mock the registry module
vi.mock('@core/agent/registry/registry.js', () => ({
    getAgentRegistry: vi.fn(),
}));

describe('Uninstall Command', () => {
    let mockRegistry: any;
    let consoleSpy: any;
    let consoleErrorSpy: any;

    beforeEach(async () => {
        vi.clearAllMocks();

        // Create mock registry
        mockRegistry = {
            getInstalledAgents: vi.fn(),
            uninstallAgent: vi.fn(),
        };

        // Mock getAgentRegistry to return our mock
        const registryModule = await import('@core/agent/registry/registry.js');
        vi.mocked(registryModule.getAgentRegistry).mockReturnValue(mockRegistry);

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
            mockRegistry.getInstalledAgents.mockResolvedValue(['some-agent']);

            await expect(handleUninstallCommand([], {})).rejects.toThrow(/No agents specified/);
        });

        it('rejects when no agents are installed', async () => {
            mockRegistry.getInstalledAgents.mockResolvedValue([]);

            await expect(handleUninstallCommand(['any-agent'], {})).rejects.toThrow(
                /No agents are currently installed/
            );
            expect(mockRegistry.uninstallAgent).not.toHaveBeenCalled();
        });

        it('rejects uninstalling agents that are not installed', async () => {
            mockRegistry.getInstalledAgents.mockResolvedValue(['real-agent']);

            await expect(handleUninstallCommand(['fake-agent'], {})).rejects.toThrow(
                /not installed/
            );
        });
    });

    describe('Single agent uninstall', () => {
        it('successfully uninstalls existing agent', async () => {
            mockRegistry.getInstalledAgents.mockResolvedValue(['test-agent']);
            mockRegistry.uninstallAgent.mockResolvedValue(undefined);

            await expect(handleUninstallCommand(['test-agent'], {})).resolves.not.toThrow();

            expect(mockRegistry.uninstallAgent).toHaveBeenCalledWith('test-agent', false);
            // Single agent uninstalls don't show summary, just per-agent messages
            expect(consoleSpy).toHaveBeenCalled();
        });

        it('passes force flag correctly', async () => {
            mockRegistry.getInstalledAgents.mockResolvedValue(['default-agent']);
            mockRegistry.uninstallAgent.mockResolvedValue(undefined);

            await handleUninstallCommand(['default-agent'], { force: true });

            expect(mockRegistry.uninstallAgent).toHaveBeenCalledWith('default-agent', true);
        });
    });

    describe('Bulk uninstall', () => {
        it('uninstalls all agents when --all flag is used', async () => {
            mockRegistry.getInstalledAgents.mockResolvedValue(['agent1', 'agent2', 'agent3']);
            mockRegistry.uninstallAgent.mockResolvedValue(undefined);

            await expect(handleUninstallCommand([], { all: true })).resolves.not.toThrow();

            expect(mockRegistry.uninstallAgent).toHaveBeenCalledTimes(3);
            expect(mockRegistry.uninstallAgent).toHaveBeenCalledWith('agent1', false);
            expect(mockRegistry.uninstallAgent).toHaveBeenCalledWith('agent2', false);
            expect(mockRegistry.uninstallAgent).toHaveBeenCalledWith('agent3', false);
            // Multiple agents show summary
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('📊 Uninstallation Summary')
            );
        });
    });

    describe('Error handling', () => {
        it('continues with other agents when one fails', async () => {
            mockRegistry.getInstalledAgents.mockResolvedValue(['good-agent', 'bad-agent']);
            mockRegistry.uninstallAgent.mockImplementation((agent: string) => {
                if (agent === 'bad-agent') {
                    throw new Error('Cannot remove protected agent');
                }
                return Promise.resolve(undefined);
            });

            await expect(
                handleUninstallCommand(['good-agent', 'bad-agent'], {})
            ).resolves.not.toThrow();

            expect(mockRegistry.uninstallAgent).toHaveBeenCalledTimes(2);
            // Should show summary for multiple agents
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('📊 Uninstallation Summary')
            );
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Failed to uninstall bad-agent')
            );
        });

        it('throws when all uninstalls fail with single agent', async () => {
            mockRegistry.getInstalledAgents.mockResolvedValue(['bad-agent']);
            mockRegistry.uninstallAgent.mockRejectedValue(new Error('Protection error'));

            // Single agent failure should propagate the error directly
            await expect(handleUninstallCommand(['bad-agent'], {})).rejects.toThrow();
        });
    });
});
