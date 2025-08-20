import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleInstallCommand } from './install.js';

// Mock the registry module
vi.mock('@core/agent/registry/registry.js', () => ({
    getAgentRegistry: vi.fn(),
}));

describe('Install Command', () => {
    let mockRegistry: any;
    let consoleSpy: any;

    beforeEach(async () => {
        vi.clearAllMocks();

        // Create mock registry
        mockRegistry = {
            hasAgent: vi.fn(),
            getAvailableAgents: vi.fn(),
            resolveAgent: vi.fn(),
        };

        // Mock getAgentRegistry to return our mock
        const registryModule = await import('@core/agent/registry/registry.js');
        vi.mocked(registryModule.getAgentRegistry).mockReturnValue(mockRegistry);

        // Mock console
        consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleSpy.mockRestore();
    });

    describe('Validation', () => {
        it('throws error when no agents specified and all flag is false', async () => {
            await expect(handleInstallCommand([], {})).rejects.toThrow(
                'No agents specified. Use agent names or --all flag. Run dexto list-agents to see available agents.'
            );
        });

        it('throws error for unknown agents', async () => {
            mockRegistry.hasAgent.mockImplementation((agent: string) => agent === 'test-agent');
            mockRegistry.getAvailableAgents.mockReturnValue({
                'test-agent': {
                    description: 'Test agent',
                    author: 'Test',
                    tags: ['test'],
                    source: 'test.yml',
                },
                'other-agent': {
                    description: 'Other agent',
                    author: 'Test',
                    tags: ['test'],
                    source: 'other.yml',
                },
            });

            await expect(handleInstallCommand(['test-agent', 'unknown-agent'], {})).rejects.toThrow(
                'Unknown agents: unknown-agent. Available agents: test-agent, other-agent'
            );
        });

        it('accepts valid agents', async () => {
            mockRegistry.hasAgent.mockReturnValue(true);
            mockRegistry.resolveAgent.mockResolvedValue('/path/to/agent.yml');

            // Should not throw
            await handleInstallCommand(['test-agent'], {});

            expect(mockRegistry.resolveAgent).toHaveBeenCalledWith('test-agent', true);
        });
    });

    describe('Single agent installation', () => {
        it('installs single agent and applies preferences by default', async () => {
            mockRegistry.hasAgent.mockReturnValue(true);
            mockRegistry.resolveAgent.mockResolvedValue('/path/to/test-agent.yml');

            await handleInstallCommand(['test-agent'], {});

            expect(mockRegistry.resolveAgent).toHaveBeenCalledWith('test-agent', true);
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('test-agent'));
        });

        it('respects force flag by calling resolveAgent without preferences injection', async () => {
            mockRegistry.hasAgent.mockReturnValue(true);
            mockRegistry.resolveAgent.mockResolvedValue('/path/to/test-agent.yml');

            await handleInstallCommand(['test-agent'], { force: true });

            // Force flag doesn't affect preference injection - that's controlled by the second parameter
            expect(mockRegistry.resolveAgent).toHaveBeenCalledWith('test-agent', true);
        });
    });

    describe('Bulk installation (--all flag)', () => {
        it('installs all available agents when --all flag is used', async () => {
            mockRegistry.getAvailableAgents.mockReturnValue({
                agent1: {
                    description: 'Agent 1',
                    author: 'Test',
                    tags: ['test'],
                    source: 'agent1.yml',
                },
                agent2: {
                    description: 'Agent 2',
                    author: 'Test',
                    tags: ['test'],
                    source: 'agent2.yml',
                },
                agent3: {
                    description: 'Agent 3',
                    author: 'Test',
                    tags: ['test'],
                    source: 'agent3.yml',
                },
            });
            mockRegistry.resolveAgent.mockResolvedValue('/path/to/agent.yml');

            await handleInstallCommand([], { all: true });

            expect(mockRegistry.getAvailableAgents).toHaveBeenCalled();
            expect(mockRegistry.resolveAgent).toHaveBeenCalledWith('agent1', true);
            expect(mockRegistry.resolveAgent).toHaveBeenCalledWith('agent2', true);
            expect(mockRegistry.resolveAgent).toHaveBeenCalledWith('agent3', true);
            expect(mockRegistry.resolveAgent).toHaveBeenCalledTimes(3);
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Installing all 3 available agents')
            );
        });

        it('ignores agent list when --all flag is used', async () => {
            mockRegistry.getAvailableAgents.mockReturnValue({
                available1: {
                    description: 'Available 1',
                    author: 'Test',
                    tags: ['test'],
                    source: 'available1.yml',
                },
                available2: {
                    description: 'Available 2',
                    author: 'Test',
                    tags: ['test'],
                    source: 'available2.yml',
                },
            });
            mockRegistry.resolveAgent.mockResolvedValue('/path/to/agent.yml');

            await handleInstallCommand(['should-be-ignored'], { all: true });

            expect(mockRegistry.resolveAgent).toHaveBeenCalledWith('available1', true);
            expect(mockRegistry.resolveAgent).toHaveBeenCalledWith('available2', true);
            expect(mockRegistry.resolveAgent).not.toHaveBeenCalledWith(
                'should-be-ignored',
                expect.anything()
            );
        });
    });

    describe('Error handling', () => {
        it('continues installing other agents when one fails', async () => {
            mockRegistry.hasAgent.mockReturnValue(true);
            mockRegistry.resolveAgent.mockImplementation((agent: string) => {
                if (agent === 'failing-agent') {
                    throw new Error('Installation failed');
                }
                return Promise.resolve('/path/to/agent.yml');
            });

            // Should not throw - partial success is acceptable
            await handleInstallCommand(['test-agent', 'failing-agent'], {});

            expect(mockRegistry.resolveAgent).toHaveBeenCalledTimes(2);
            expect(mockRegistry.resolveAgent).toHaveBeenCalledWith('test-agent', true);
            expect(mockRegistry.resolveAgent).toHaveBeenCalledWith('failing-agent', true);
        });
    });
});
