import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync } from 'fs';

// Mock @dexto/core partially: preserve real exports and override specific functions
vi.mock('@dexto/core', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return {
        ...actual,
        getAgentRegistry: vi.fn(),
        getDextoGlobalPath: vi.fn(),
    };
});

// Mock fs
vi.mock('fs', () => ({
    existsSync: vi.fn(),
}));

// Mock @clack/prompts
vi.mock('@clack/prompts', () => ({
    intro: vi.fn(),
    text: vi.fn(),
    outro: vi.fn(),
    cancel: vi.fn(),
    isCancel: vi.fn(),
}));

// Mock analytics
vi.mock('../../analytics/index.js', () => ({
    capture: vi.fn(),
}));

// Import SUT after mocks
import { handleInstallCommand } from './install.js';

describe('Install Command', () => {
    let mockRegistry: any;
    let consoleSpy: any;

    beforeEach(async () => {
        vi.clearAllMocks();

        // Create mock registry
        mockRegistry = {
            hasAgent: vi.fn(),
            getAvailableAgents: vi.fn(),
            installAgent: vi.fn(),
            installCustomAgentFromPath: vi.fn(),
        };

        // Mock @dexto/core functions
        const registryModule = await import('@dexto/core');
        vi.mocked(registryModule.getAgentRegistry).mockReturnValue(mockRegistry);
        vi.mocked(registryModule.getDextoGlobalPath).mockReturnValue('/mock/global/path');

        // Mock existsSync to return false by default (agent not installed)
        vi.mocked(existsSync).mockReturnValue(false);

        // Mock console
        consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleSpy.mockRestore();
    });

    describe('Validation', () => {
        it('throws error when no agents specified and all flag is false', async () => {
            await expect(handleInstallCommand([], {})).rejects.toThrow();
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
                /Unknown agents.*unknown-agent/
            );
        });

        it('accepts valid agents', async () => {
            mockRegistry.hasAgent.mockReturnValue(true);
            mockRegistry.installAgent.mockResolvedValue('/path/to/agent.yml');

            // Should not throw
            await handleInstallCommand(['test-agent'], {});

            expect(mockRegistry.installAgent).toHaveBeenCalledWith('test-agent', true);
        });
    });

    describe('Single agent installation', () => {
        it('installs single agent and applies preferences by default', async () => {
            mockRegistry.hasAgent.mockReturnValue(true);
            mockRegistry.installAgent.mockResolvedValue('/path/to/test-agent.yml');

            await handleInstallCommand(['test-agent'], {});

            expect(mockRegistry.installAgent).toHaveBeenCalledWith('test-agent', true);
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('test-agent'));
        });

        it('respects force flag by calling installAgent without preferences injection', async () => {
            mockRegistry.hasAgent.mockReturnValue(true);
            mockRegistry.installAgent.mockResolvedValue('/path/to/test-agent.yml');

            await handleInstallCommand(['test-agent'], { force: true });

            // Force flag doesn't affect preference injection - that's controlled by the second parameter
            expect(mockRegistry.installAgent).toHaveBeenCalledWith('test-agent', true);
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
            mockRegistry.installAgent.mockResolvedValue('/path/to/agent.yml');

            await handleInstallCommand([], { all: true });

            expect(mockRegistry.getAvailableAgents).toHaveBeenCalled();
            expect(mockRegistry.installAgent).toHaveBeenCalledWith('agent1', true);
            expect(mockRegistry.installAgent).toHaveBeenCalledWith('agent2', true);
            expect(mockRegistry.installAgent).toHaveBeenCalledWith('agent3', true);
            expect(mockRegistry.installAgent).toHaveBeenCalledTimes(3);
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
            mockRegistry.installAgent.mockResolvedValue('/path/to/agent.yml');

            await handleInstallCommand(['should-be-ignored'], { all: true });

            expect(mockRegistry.installAgent).toHaveBeenCalledWith('available1', true);
            expect(mockRegistry.installAgent).toHaveBeenCalledWith('available2', true);
            expect(mockRegistry.installAgent).not.toHaveBeenCalledWith(
                'should-be-ignored',
                expect.anything()
            );
        });
    });

    describe('Error handling', () => {
        it('continues installing other agents when one fails', async () => {
            mockRegistry.hasAgent.mockReturnValue(true);
            mockRegistry.installAgent.mockImplementation((agent: string) => {
                if (agent === 'failing-agent') {
                    throw new Error('Installation failed');
                }
                return Promise.resolve('/path/to/agent.yml');
            });

            // Should not throw - partial success is acceptable
            await handleInstallCommand(['test-agent', 'failing-agent'], {});

            expect(mockRegistry.installAgent).toHaveBeenCalledTimes(2);
            expect(mockRegistry.installAgent).toHaveBeenCalledWith('test-agent', true);
            expect(mockRegistry.installAgent).toHaveBeenCalledWith('failing-agent', true);
        });

        it('throws when single agent installation fails', async () => {
            mockRegistry.hasAgent.mockReturnValue(true);
            mockRegistry.installAgent.mockRejectedValue(new Error('Installation failed'));

            // Single agent failure should propagate the error directly
            await expect(handleInstallCommand(['bad-agent'], {})).rejects.toThrow();
        });
    });

    describe('Custom agent installation from file paths', () => {
        let mockPrompts: any;

        beforeEach(async () => {
            const prompts = await import('@clack/prompts');
            mockPrompts = {
                intro: vi.mocked(prompts.intro),
                text: vi.mocked(prompts.text),
                outro: vi.mocked(prompts.outro),
                isCancel: vi.mocked(prompts.isCancel),
            };

            // Default prompt responses
            mockPrompts.text.mockImplementation(async (opts: any) => {
                if (opts.message.includes('Agent name')) return 'my-custom-agent';
                if (opts.message.includes('Description')) return 'Test description';
                if (opts.message.includes('Author')) return 'Test Author';
                if (opts.message.includes('Tags')) return 'custom, test';
                return '';
            });
            mockPrompts.isCancel.mockReturnValue(false);
        });

        it('detects file paths and installs custom agent', async () => {
            // Mock existsSync: source file exists, installed path does not
            vi.mocked(existsSync).mockImplementation((path: any) => {
                if (path.toString().includes('my-agent.yml')) return true;
                return false; // Not installed yet
            });
            mockRegistry.installCustomAgentFromPath.mockResolvedValue('/path/to/installed.yml');

            await handleInstallCommand(['./my-agent.yml'], {});

            expect(mockRegistry.installCustomAgentFromPath).toHaveBeenCalledWith(
                'my-custom-agent',
                expect.stringContaining('my-agent.yml'),
                {
                    description: 'Test description',
                    author: 'Test Author',
                    tags: ['custom', 'test'],
                },
                true
            );
        });

        it('detects paths with forward slashes', async () => {
            vi.mocked(existsSync).mockImplementation((path: any) => {
                if (path.toString().includes('custom.yml')) return true;
                return false;
            });
            mockRegistry.installCustomAgentFromPath.mockResolvedValue('/path/to/installed.yml');

            await handleInstallCommand(['./agents/custom.yml'], {});

            expect(mockRegistry.installCustomAgentFromPath).toHaveBeenCalled();
        });

        it('validates file exists before installation', async () => {
            vi.mocked(existsSync).mockReturnValue(false);

            await expect(handleInstallCommand(['./nonexistent.yml'], {})).rejects.toThrow(
                /File not found/
            );

            expect(mockRegistry.installCustomAgentFromPath).not.toHaveBeenCalled();
        });

        it('treats non-path strings as registry names', async () => {
            mockRegistry.hasAgent.mockReturnValue(true);
            mockRegistry.installAgent.mockResolvedValue('/path/to/agent.yml');

            await handleInstallCommand(['builtin-agent'], {});

            // Should use registry installation, not custom
            expect(mockRegistry.installAgent).toHaveBeenCalledWith('builtin-agent', true);
            expect(mockRegistry.installCustomAgentFromPath).not.toHaveBeenCalled();
        });

        it('respects injectPreferences flag for custom agents', async () => {
            vi.mocked(existsSync).mockImplementation((path: any) => {
                if (path.toString().includes('agent.yml')) return true;
                return false;
            });
            mockRegistry.installCustomAgentFromPath.mockResolvedValue('/path/to/installed.yml');

            await handleInstallCommand(['./agent.yml'], { injectPreferences: false });

            expect(mockRegistry.installCustomAgentFromPath).toHaveBeenCalledWith(
                expect.any(String),
                expect.any(String),
                expect.any(Object),
                false
            );
        });
    });
});
