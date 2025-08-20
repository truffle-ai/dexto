import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { handleInstallCommand } from './install.js';

// Mock only external dependencies that can't be tested directly
vi.mock('@core/agent/registry/registry.js', () => ({
    getAgentRegistry: vi.fn(),
}));

vi.mock('@core/utils/path.js', () => ({
    getDextoGlobalPath: vi.fn(),
}));

describe('Install Command', () => {
    let tempDir: string;
    let mockRegistry: any;
    let mockGetDextoGlobalPath: any;
    let consoleSpy: any;

    function createTempDir() {
        return fs.mkdtempSync(path.join(tmpdir(), 'install-test-'));
    }

    beforeEach(async () => {
        vi.clearAllMocks();
        tempDir = createTempDir();

        // Get mock functions
        const registryModule = await import('@core/agent/registry/registry.js');
        const pathModule = await import('@core/utils/path.js');

        mockGetDextoGlobalPath = vi.mocked(pathModule.getDextoGlobalPath);

        // Create a mock registry object with all required methods
        mockRegistry = {
            hasAgent: vi.fn().mockReturnValue(true),
            getAvailableAgents: vi
                .fn()
                .mockReturnValue(['test-agent', 'another-agent', 'third-agent']),
            resolveAgent: vi.fn().mockResolvedValue('/path/to/installed/agent'),
        };

        // Mock the getAgentRegistry function to return our mock registry
        vi.mocked(registryModule.getAgentRegistry).mockReturnValue(mockRegistry);

        // Default mocks
        mockGetDextoGlobalPath.mockReturnValue(path.join(tempDir, '.dexto', 'agents'));

        // Mock console to prevent test output noise
        consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
        consoleSpy.mockRestore();
    });

    describe('Validation', () => {
        it('throws error when no agents specified and all flag is false', async () => {
            await expect(handleInstallCommand([], {})).rejects.toThrow(
                'No agents specified. Use agent names or --all flag. Run dexto list-agents to see available agents.'
            );
        });

        it('throws error for unknown agents', async () => {
            mockRegistry.hasAgent.mockImplementation((agent: string) => agent !== 'unknown-agent');
            mockRegistry.getAvailableAgents.mockReturnValue(['test-agent', 'another-agent']);

            await expect(handleInstallCommand(['test-agent', 'unknown-agent'], {})).rejects.toThrow(
                'Unknown agents: unknown-agent. Available agents: test-agent, another-agent'
            );
        });

        it('accepts valid agents', async () => {
            mockRegistry.hasAgent.mockReturnValue(true);

            await handleInstallCommand(['test-agent'], {});

            expect(mockRegistry.resolveAgent).toHaveBeenCalledWith('test-agent', true);
        });

        it('validates schema correctly with defaults', async () => {
            const options = {}; // Should apply defaults

            await handleInstallCommand(['test-agent'], options);

            expect(mockRegistry.resolveAgent).toHaveBeenCalledWith('test-agent', true); // injectPreferences default true
        });

        it('throws validation error for empty agent names', async () => {
            await expect(handleInstallCommand([''], {})).rejects.toThrow();
        });

        it('handles strict mode validation correctly', async () => {
            const options = {
                unknownField: 'should-cause-error',
            } as any;

            await expect(handleInstallCommand(['test-agent'], options)).rejects.toThrow(
                /Unrecognized key.*unknownField/
            );
        });
    });

    describe('Single agent installation', () => {
        it('installs a single agent successfully', async () => {
            await handleInstallCommand(['test-agent'], {});

            expect(mockRegistry.resolveAgent).toHaveBeenCalledWith('test-agent', true);
        });

        it('skips already installed agent without force flag', async () => {
            // Create existing agent directory
            const agentsDir = path.join(tempDir, '.dexto', 'agents');
            const agentDir = path.join(agentsDir, 'test-agent');
            fs.mkdirSync(agentDir, { recursive: true });

            await handleInstallCommand(['test-agent'], {});

            expect(mockRegistry.resolveAgent).not.toHaveBeenCalled();
        });

        it('reinstalls already installed agent with force flag', async () => {
            // Create existing agent directory
            const agentsDir = path.join(tempDir, '.dexto', 'agents');
            const agentDir = path.join(agentsDir, 'test-agent');
            fs.mkdirSync(agentDir, { recursive: true });

            await handleInstallCommand(['test-agent'], { force: true });

            expect(mockRegistry.resolveAgent).toHaveBeenCalledWith('test-agent', true);
        });

        it('passes injectPreferences parameter correctly', async () => {
            await handleInstallCommand(['test-agent'], { injectPreferences: false });

            expect(mockRegistry.resolveAgent).toHaveBeenCalledWith('test-agent', false);
        });
    });

    describe('Multiple agent installation', () => {
        it('installs multiple agents successfully', async () => {
            await handleInstallCommand(['test-agent', 'another-agent'], {});

            expect(mockRegistry.resolveAgent).toHaveBeenCalledWith('test-agent', true);
            expect(mockRegistry.resolveAgent).toHaveBeenCalledWith('another-agent', true);
            expect(mockRegistry.resolveAgent).toHaveBeenCalledTimes(2);
        });

        it('continues installation even if one agent fails', async () => {
            mockRegistry.resolveAgent.mockImplementation((agent: string) => {
                if (agent === 'failing-agent') {
                    throw new Error('Installation failed');
                }
                return Promise.resolve('/path/to/installed/agent');
            });

            await handleInstallCommand(['test-agent', 'failing-agent', 'another-agent'], {});

            expect(mockRegistry.resolveAgent).toHaveBeenCalledWith('test-agent', true);
            expect(mockRegistry.resolveAgent).toHaveBeenCalledWith('failing-agent', true);
            expect(mockRegistry.resolveAgent).toHaveBeenCalledWith('another-agent', true);
            expect(mockRegistry.resolveAgent).toHaveBeenCalledTimes(3);
        });

        it('throws error when all installations fail', async () => {
            mockRegistry.resolveAgent.mockRejectedValue(new Error('Installation failed'));

            await expect(handleInstallCommand(['test-agent', 'another-agent'], {})).rejects.toThrow(
                'All installations failed'
            );
        });

        it('succeeds when some installations fail but others succeed', async () => {
            mockRegistry.resolveAgent.mockImplementation((agent: string) => {
                if (agent === 'failing-agent') {
                    throw new Error('Installation failed');
                }
                return Promise.resolve('/path/to/installed/agent');
            });

            // Should not throw - partial success is acceptable
            await handleInstallCommand(['test-agent', 'failing-agent'], {});

            expect(mockRegistry.resolveAgent).toHaveBeenCalledTimes(2);
        });
    });

    describe('Bulk installation (--all flag)', () => {
        it('installs all available agents when --all flag is used', async () => {
            mockRegistry.getAvailableAgents.mockReturnValue(['agent1', 'agent2', 'agent3']);

            await handleInstallCommand([], { all: true });

            expect(mockRegistry.getAvailableAgents).toHaveBeenCalled();
            expect(mockRegistry.resolveAgent).toHaveBeenCalledWith('agent1', true);
            expect(mockRegistry.resolveAgent).toHaveBeenCalledWith('agent2', true);
            expect(mockRegistry.resolveAgent).toHaveBeenCalledWith('agent3', true);
            expect(mockRegistry.resolveAgent).toHaveBeenCalledTimes(3);
        });

        it('ignores agent list when --all flag is used', async () => {
            mockRegistry.getAvailableAgents.mockReturnValue(['available1', 'available2']);

            await handleInstallCommand(['should-be-ignored'], { all: true });

            expect(mockRegistry.resolveAgent).toHaveBeenCalledWith('available1', true);
            expect(mockRegistry.resolveAgent).toHaveBeenCalledWith('available2', true);
            expect(mockRegistry.resolveAgent).not.toHaveBeenCalledWith(
                'should-be-ignored',
                expect.anything()
            );
        });

        it('respects force flag with --all', async () => {
            mockRegistry.getAvailableAgents.mockReturnValue(['agent1']);
            // Create existing agent directory
            const agentsDir = path.join(tempDir, '.dexto', 'agents');
            const agentDir = path.join(agentsDir, 'agent1');
            fs.mkdirSync(agentDir, { recursive: true });

            await handleInstallCommand([], { all: true, force: true });

            expect(mockRegistry.resolveAgent).toHaveBeenCalledWith('agent1', true);
        });

        it('skips existing agents without force flag with --all', async () => {
            mockRegistry.getAvailableAgents.mockReturnValue(['agent1', 'agent2']);
            // Create existing agent directory for agent1
            const agentsDir = path.join(tempDir, '.dexto', 'agents');
            const agentDir = path.join(agentsDir, 'agent1');
            fs.mkdirSync(agentDir, { recursive: true });

            await handleInstallCommand([], { all: true });

            expect(mockRegistry.resolveAgent).not.toHaveBeenCalledWith('agent1', expect.anything());
            expect(mockRegistry.resolveAgent).toHaveBeenCalledWith('agent2', true);
        });
    });

    describe('Error handling', () => {
        it('throws error when single agent installation fails', async () => {
            mockRegistry.resolveAgent.mockRejectedValue(new Error('Network timeout'));

            // Should throw when all installations fail (even single agent)
            await expect(handleInstallCommand(['test-agent'], {})).rejects.toThrow(
                'All installations failed'
            );

            expect(mockRegistry.resolveAgent).toHaveBeenCalledWith('test-agent', true);
        });

        it('handles file system errors gracefully', async () => {
            // Mock getDextoGlobalPath to return a path that will cause an error
            mockGetDextoGlobalPath.mockReturnValue('/invalid/path/that/does/not/exist');

            await handleInstallCommand(['test-agent'], {});

            expect(mockRegistry.resolveAgent).toHaveBeenCalledWith('test-agent', true);
        });

        it('propagates validation errors from registry', async () => {
            mockRegistry.hasAgent.mockReturnValue(false);
            mockRegistry.getAvailableAgents.mockReturnValue(['other-agent']);

            await expect(handleInstallCommand(['invalid-agent'], {})).rejects.toThrow(
                'Unknown agents: invalid-agent. Available agents: other-agent'
            );
        });
    });

    describe('Edge cases', () => {
        it('handles empty available agents list', async () => {
            mockRegistry.getAvailableAgents.mockReturnValue([]);

            await handleInstallCommand([], { all: true });

            expect(mockRegistry.resolveAgent).not.toHaveBeenCalled();
        });

        it('handles mixed success/failure scenarios correctly', async () => {
            let callCount = 0;
            mockRegistry.resolveAgent.mockImplementation(() => {
                callCount++;
                if (callCount === 2) {
                    throw new Error('Middle agent failed');
                }
                return Promise.resolve('/path/to/installed/agent');
            });

            await handleInstallCommand(['agent1', 'agent2', 'agent3'], {});

            expect(mockRegistry.resolveAgent).toHaveBeenCalledTimes(3);
        });

        it('preserves options across multiple installations', async () => {
            await handleInstallCommand(['agent1', 'agent2'], {
                injectPreferences: false,
                force: true,
            });

            expect(mockRegistry.resolveAgent).toHaveBeenCalledWith('agent1', false);
            expect(mockRegistry.resolveAgent).toHaveBeenCalledWith('agent2', false);
        });
    });
});
