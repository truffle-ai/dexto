import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { LocalAgentRegistry } from './registry.js';
import { RegistryErrorCode } from './error-codes.js';
import { ErrorType } from '@dexto/core';

// Mock dependencies
vi.mock('../utils/path.js', () => ({
    resolveBundledScript: vi.fn(),
    getDextoGlobalPath: vi.fn(),
    copyDirectory: vi.fn(),
}));

vi.mock('@dexto/core', async () => {
    const actual = await vi.importActual<typeof import('@dexto/core')>('@dexto/core');
    return {
        ...actual,
        logger: {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        },
    };
});
vi.mock('../preferences/loader.js');

describe('LocalAgentRegistry', () => {
    let tempDir: string;
    let registry: LocalAgentRegistry;
    let mockResolveBundledScript: any;
    let mockGetDextoGlobalPath: any;
    let mockLoadGlobalPreferences: any;

    function createTempDir() {
        return fs.mkdtempSync(path.join(tmpdir(), 'registry-test-'));
    }

    function createRegistryFile(registryPath: string, agents: Record<string, any>) {
        fs.writeFileSync(
            registryPath,
            JSON.stringify({
                version: '1.0.0',
                agents,
            })
        );
    }

    beforeEach(async () => {
        vi.clearAllMocks();
        tempDir = createTempDir();

        // Import and mock path utilities
        const pathUtils = await import('../utils/path.js');
        const prefUtils = await import('../preferences/loader.js');

        mockResolveBundledScript = vi.mocked(pathUtils.resolveBundledScript);
        mockGetDextoGlobalPath = vi.mocked(pathUtils.getDextoGlobalPath);
        mockLoadGlobalPreferences = vi.mocked(prefUtils.loadGlobalPreferences);

        // Setup registry file
        const registryPath = path.join(tempDir, 'user-agent-registry.json');
        createRegistryFile(registryPath, {
            'test-agent': {
                id: 'test-agent',
                name: 'Test Agent',
                description: 'Test agent',
                author: 'Test',
                tags: ['test'],
                source: 'test-agent.yml',
            },
            'dir-agent': {
                id: 'dir-agent',
                name: 'Dir Agent',
                description: 'Directory agent',
                author: 'Test',
                tags: ['test'],
                source: 'dir-agent/',
                main: 'main.yml',
            },
            'auto-test-agent': {
                id: 'auto-test-agent',
                name: 'Auto Test Agent',
                description: 'Auto-install test agent',
                author: 'Test',
                tags: ['test'],
                source: 'auto-test-agent.yml',
            },
        });

        // Mock path functions
        mockResolveBundledScript.mockReturnValue(registryPath);
        mockGetDextoGlobalPath.mockImplementation((type: string, filename?: string) => {
            if (filename) {
                return path.join(tempDir, filename);
            }
            if (type === 'agents') {
                return path.join(tempDir, 'global', type);
            }
            return path.join(tempDir, 'global');
        });

        // Mock preferences
        mockLoadGlobalPreferences.mockResolvedValue({
            llm: { provider: 'openai', model: 'gpt-5', apiKey: '$OPENAI_API_KEY' },
        });

        registry = new LocalAgentRegistry();
    });

    afterEach(() => {
        // Clean up temp directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    describe('hasAgent', () => {
        it('returns true for agents in registry', () => {
            expect(registry.hasAgent('test-agent')).toBe(true);
            expect(registry.hasAgent('dir-agent')).toBe(true);
        });

        it('returns false for agents not in registry', () => {
            expect(registry.hasAgent('nonexistent-agent')).toBe(false);
        });
    });

    describe('getAvailableAgents', () => {
        it('returns registry data with full metadata for all agents', () => {
            const agents = registry.getAvailableAgents();

            // Should return the full registry agents object
            expect(agents).toEqual({
                'test-agent': {
                    id: 'test-agent',
                    name: 'Test Agent',
                    description: 'Test agent',
                    author: 'Test',
                    tags: ['test'],
                    source: 'test-agent.yml',
                    type: 'builtin',
                },
                'dir-agent': {
                    id: 'dir-agent',
                    name: 'Dir Agent',
                    description: 'Directory agent',
                    author: 'Test',
                    tags: ['test'],
                    source: 'dir-agent/',
                    main: 'main.yml',
                    type: 'builtin',
                },
                'auto-test-agent': {
                    id: 'auto-test-agent',
                    name: 'Auto Test Agent',
                    description: 'Auto-install test agent',
                    author: 'Test',
                    tags: ['test'],
                    source: 'auto-test-agent.yml',
                    type: 'builtin',
                },
            });

            // Should have correct number of agents
            expect(Object.keys(agents)).toHaveLength(3);
        });
    });

    describe('getRegistry', () => {
        it('returns parsed registry data with correct structure', () => {
            const registryData = registry.getRegistry();

            expect(registryData).toEqual({
                version: '1.0.0',
                agents: {
                    'test-agent': {
                        id: 'test-agent',
                        name: 'Test Agent',
                        description: 'Test agent',
                        author: 'Test',
                        tags: ['test'],
                        source: 'test-agent.yml',
                        type: 'builtin',
                    },
                    'dir-agent': {
                        id: 'dir-agent',
                        name: 'Dir Agent',
                        description: 'Directory agent',
                        author: 'Test',
                        tags: ['test'],
                        source: 'dir-agent/',
                        main: 'main.yml',
                        type: 'builtin',
                    },
                    'auto-test-agent': {
                        id: 'auto-test-agent',
                        name: 'Auto Test Agent',
                        description: 'Auto-install test agent',
                        author: 'Test',
                        tags: ['test'],
                        source: 'auto-test-agent.yml',
                        type: 'builtin',
                    },
                },
            });
        });

        it('caches registry data on subsequent calls', () => {
            const first = registry.getRegistry();
            const second = registry.getRegistry();

            // Should return the same object instance (cached)
            expect(first).toBe(second);
        });
    });

    describe('installAgent', () => {
        it('throws proper error for unknown agent', async () => {
            await expect(registry.installAgent('unknown-agent')).rejects.toMatchObject({
                code: RegistryErrorCode.AGENT_NOT_FOUND,
                scope: 'agent_registry',
                type: ErrorType.USER,
                context: {
                    agentId: 'unknown-agent',
                    availableAgents: expect.arrayContaining(['test-agent', 'dir-agent']),
                },
            });
        });

        it('installs single-file agent', async () => {
            // Create the bundled agent file
            const bundledAgentsPath = path.join(tempDir, 'bundled', 'agents');
            fs.mkdirSync(bundledAgentsPath, { recursive: true });
            fs.writeFileSync(
                path.join(bundledAgentsPath, 'test-agent.yml'),
                'llm:\n  provider: anthropic\n  model: claude-sonnet-4-5-20250929'
            );

            // Mock resolveBundledScript to return our test files
            mockResolveBundledScript.mockImplementation((relativePath: string) => {
                if (relativePath === 'agents/test-agent.yml') {
                    return path.join(bundledAgentsPath, 'test-agent.yml');
                }
                // Return original registry path
                return path.join(tempDir, 'user-agent-registry.json');
            });

            // Create a fresh registry instance to pick up the new mock
            const freshRegistry = new LocalAgentRegistry();
            const result = await freshRegistry.installAgent('test-agent');

            // Should return path to installed config
            expect(result).toMatch(/test-agent\.yml$/);
            expect(fs.existsSync(result)).toBe(true);

            // Verify the file was actually copied
            const installedContent = fs.readFileSync(result, 'utf-8');
            expect(installedContent).toContain('provider: anthropic');
        });

        it('installs directory agent with main config file', async () => {
            // Create directory agent structure
            const bundledAgentsPath = path.join(tempDir, 'bundled', 'agents');
            const dirAgentPath = path.join(bundledAgentsPath, 'dir-agent');
            fs.mkdirSync(dirAgentPath, { recursive: true });
            fs.writeFileSync(
                path.join(dirAgentPath, 'main.yml'),
                'llm:\n  provider: openai\n  model: gpt-5'
            );
            fs.writeFileSync(path.join(dirAgentPath, 'extra.md'), '# Documentation');

            // We also need to mock copyDirectory since it's used for directory agents
            const pathUtils = await import('../utils/path.js');
            const mockCopyDirectory = vi.mocked(pathUtils.copyDirectory);
            mockCopyDirectory.mockImplementation(async (src: string, dest: string) => {
                // Manually copy the directory structure for the test
                fs.mkdirSync(dest, { recursive: true });
                const files = fs.readdirSync(src);
                for (const file of files) {
                    const srcFile = path.join(src, file);
                    const destFile = path.join(dest, file);
                    if (fs.statSync(srcFile).isFile()) {
                        fs.copyFileSync(srcFile, destFile);
                    }
                }
            });

            // Mock resolveBundledScript for directory
            mockResolveBundledScript.mockImplementation((relativePath: string) => {
                if (relativePath === 'agents/dir-agent/') {
                    return dirAgentPath;
                }
                return path.join(tempDir, 'user-agent-registry.json');
            });

            // Create fresh registry
            const freshRegistry = new LocalAgentRegistry();
            const result = await freshRegistry.installAgent('dir-agent');

            // Should return path to main config file
            expect(result).toMatch(/main\.yml$/);
            expect(fs.existsSync(result)).toBe(true);

            // Should have installed the whole directory
            const installedDirPath = path.dirname(result);
            expect(fs.existsSync(path.join(installedDirPath, 'extra.md'))).toBe(true);

            // Verify actual file contents
            const mainContent = fs.readFileSync(result, 'utf-8');
            expect(mainContent).toContain('provider: openai');
            const extraContent = fs.readFileSync(path.join(installedDirPath, 'extra.md'), 'utf-8');
            expect(extraContent).toContain('# Documentation');
        });
    });

    describe('resolveAgent', () => {
        it('throws structured RegistryError for unknown agent with complete error properties', async () => {
            await expect(registry.resolveAgent('unknown-agent')).rejects.toMatchObject({
                code: RegistryErrorCode.AGENT_NOT_FOUND,
                scope: 'agent_registry',
                type: ErrorType.USER,
                context: {
                    agentId: 'unknown-agent',
                    availableAgents: expect.arrayContaining(['test-agent', 'dir-agent']),
                },
                recovery: expect.stringContaining('Available agents:'),
            });
        });

        it('resolves already installed single-file agent', async () => {
            // Create installed agent file structure
            const agentsDir = path.join(tempDir, 'global', 'agents');
            const agentPath = path.join(agentsDir, 'test-agent');
            fs.mkdirSync(agentPath, { recursive: true });
            fs.writeFileSync(path.join(agentPath, 'test-agent.yml'), 'test: config');

            const result = await registry.resolveAgent('test-agent');
            expect(result).toBe(path.join(agentPath, 'test-agent.yml'));
        });

        it('resolves already installed directory agent with main config', async () => {
            // Create installed directory agent structure
            const agentsDir = path.join(tempDir, 'global', 'agents');
            const agentPath = path.join(agentsDir, 'dir-agent');
            fs.mkdirSync(agentPath, { recursive: true });
            fs.writeFileSync(path.join(agentPath, 'main.yml'), 'test: config');

            const result = await registry.resolveAgent('dir-agent');
            expect(result).toBe(path.join(agentPath, 'main.yml'));
        });

        describe('auto-install behavior', () => {
            beforeEach(() => {
                // Create bundled agent for auto-install tests
                const bundledPath = path.join(tempDir, 'bundled', 'agents', 'auto-test-agent.yml');
                fs.mkdirSync(path.dirname(bundledPath), { recursive: true });
                fs.writeFileSync(
                    bundledPath,
                    'name: auto-test-agent\ndescription: Test auto-install'
                );
            });

            it('auto-installs missing agent when autoInstall=true (default)', async () => {
                // Set up mocks for this specific test
                const bundledPath = path.join(tempDir, 'bundled', 'agents', 'auto-test-agent.yml');
                mockResolveBundledScript
                    .mockReturnValueOnce(path.join(tempDir, 'user-agent-registry.json'))
                    .mockReturnValueOnce(bundledPath);

                const result = await registry.resolveAgent('auto-test-agent');

                // Should return path to installed agent
                const expectedPath = path.join(
                    tempDir,
                    'global',
                    'agents',
                    'auto-test-agent',
                    'auto-test-agent.yml'
                );
                expect(result).toBe(expectedPath);

                // Verify agent was actually installed
                expect(fs.existsSync(expectedPath)).toBe(true);
            });

            it('auto-installs missing agent when autoInstall=true explicitly', async () => {
                // Set up mocks for this specific test
                const bundledPath = path.join(tempDir, 'bundled', 'agents', 'auto-test-agent.yml');
                mockResolveBundledScript
                    .mockReturnValueOnce(path.join(tempDir, 'user-agent-registry.json'))
                    .mockReturnValueOnce(bundledPath);

                const result = await registry.resolveAgent('auto-test-agent', true);

                const expectedPath = path.join(
                    tempDir,
                    'global',
                    'agents',
                    'auto-test-agent',
                    'auto-test-agent.yml'
                );
                expect(result).toBe(expectedPath);
                expect(fs.existsSync(expectedPath)).toBe(true);
            });

            it('throws error when autoInstall=false and agent not installed', async () => {
                await expect(registry.resolveAgent('auto-test-agent', false)).rejects.toMatchObject(
                    {
                        code: RegistryErrorCode.AGENT_NOT_INSTALLED_AUTO_INSTALL_DISABLED,
                        scope: 'agent_registry',
                        type: ErrorType.USER,
                        context: {
                            agentId: 'auto-test-agent',
                            availableAgents: expect.arrayContaining([
                                'test-agent',
                                'dir-agent',
                                'auto-test-agent',
                            ]),
                        },
                        recovery: expect.stringContaining('dexto install auto-test-agent'),
                    }
                );

                // Verify agent was NOT installed
                const expectedPath = path.join(tempDir, 'global', 'agents', 'auto-test-agent');
                expect(fs.existsSync(expectedPath)).toBe(false);
            });
        });
    });

    describe('resolveMainConfig', () => {
        it('handles single-file agents correctly', () => {
            // Create the expected file structure
            const agentDir = path.join(tempDir, 'test-agent-dir');
            fs.mkdirSync(agentDir, { recursive: true });
            fs.writeFileSync(path.join(agentDir, 'test-agent.yml'), 'test: config');

            const result = registry.resolveMainConfig(agentDir, 'test-agent');
            expect(result).toBe(path.join(agentDir, 'test-agent.yml'));
        });

        it('handles directory agents with main field', () => {
            // Create the expected file structure
            const agentDir = path.join(tempDir, 'dir-agent-dir');
            fs.mkdirSync(agentDir, { recursive: true });
            fs.writeFileSync(path.join(agentDir, 'main.yml'), 'test: config');

            const result = registry.resolveMainConfig(agentDir, 'dir-agent');
            expect(result).toBe(path.join(agentDir, 'main.yml'));
        });

        it('throws structured error for directory agent missing main field', () => {
            // Create registry with bad entry and mock it
            const badRegistryPath = path.join(tempDir, 'bad-registry.json');
            createRegistryFile(badRegistryPath, {
                'bad-dir-agent': {
                    id: 'bad-dir-agent',
                    name: 'Bad Dir Agent',
                    description: 'Bad directory agent',
                    author: 'Test',
                    tags: ['test'],
                    source: 'bad-dir-agent/',
                    // missing main field
                },
            });

            mockResolveBundledScript.mockReturnValue(badRegistryPath);
            const badRegistry = new LocalAgentRegistry();

            expect(() => badRegistry.resolveMainConfig('/path', 'bad-dir-agent')).toThrow(
                expect.objectContaining({
                    code: RegistryErrorCode.AGENT_INVALID_ENTRY,
                    scope: 'agent_registry',
                    type: ErrorType.SYSTEM,
                    context: {
                        agentId: 'bad-dir-agent',
                        reason: 'directory entry missing main field',
                    },
                })
            );
        });
    });

    describe('getInstalledAgents', () => {
        it('returns empty array when agents directory does not exist', async () => {
            const installedAgents = await registry.getInstalledAgents();
            expect(installedAgents).toEqual([]);
        });

        it('returns list of installed agent directories', async () => {
            const agentsDir = path.join(tempDir, 'global', 'agents');
            fs.mkdirSync(agentsDir, { recursive: true });

            // Create agent directories
            fs.mkdirSync(path.join(agentsDir, 'agent1'));
            fs.mkdirSync(path.join(agentsDir, 'agent2'));
            fs.mkdirSync(path.join(agentsDir, 'default-agent'));

            // Create temp directory (should be filtered out)
            fs.mkdirSync(path.join(agentsDir, '.tmp.123456'));

            // Create a file (should be filtered out)
            fs.writeFileSync(path.join(agentsDir, 'not-a-directory.txt'), 'content');

            const installedAgents = await registry.getInstalledAgents();

            expect(installedAgents.sort()).toEqual(['agent1', 'agent2', 'default-agent']);
        });
    });

    describe('uninstallAgent', () => {
        let agentsDir: string;

        beforeEach(() => {
            agentsDir = path.join(tempDir, 'global', 'agents');
            fs.mkdirSync(agentsDir, { recursive: true });
        });

        it('successfully removes agent directory and all contents', async () => {
            const agentPath = path.join(agentsDir, 'test-agent');
            const subDir = path.join(agentPath, 'subdir');

            // Create agent with nested structure
            fs.mkdirSync(subDir, { recursive: true });
            fs.writeFileSync(path.join(agentPath, 'config.yml'), 'test config');
            fs.writeFileSync(path.join(subDir, 'nested.txt'), 'nested content');

            // Verify it exists
            expect(fs.existsSync(agentPath)).toBe(true);
            expect(fs.existsSync(path.join(subDir, 'nested.txt'))).toBe(true);

            await registry.uninstallAgent('test-agent');

            // Verify complete removal
            expect(fs.existsSync(agentPath)).toBe(false);
        });

        it('throws error when agent is not installed', async () => {
            await expect(registry.uninstallAgent('nonexistent-agent')).rejects.toThrow(
                expect.objectContaining({
                    code: RegistryErrorCode.AGENT_NOT_INSTALLED,
                })
            );
        });

        it('protects coding-agent from deletion without force', async () => {
            const codingAgentPath = path.join(agentsDir, 'coding-agent');
            fs.mkdirSync(codingAgentPath);
            fs.writeFileSync(path.join(codingAgentPath, 'config.yml'), 'important');

            await expect(registry.uninstallAgent('coding-agent')).rejects.toThrow(
                expect.objectContaining({
                    code: RegistryErrorCode.AGENT_PROTECTED,
                })
            );

            // Verify it still exists
            expect(fs.existsSync(codingAgentPath)).toBe(true);
            expect(fs.readFileSync(path.join(codingAgentPath, 'config.yml'), 'utf-8')).toBe(
                'important'
            );
        });

        it('allows force uninstall of coding-agent', async () => {
            const codingAgentPath = path.join(agentsDir, 'coding-agent');
            fs.mkdirSync(codingAgentPath);
            fs.writeFileSync(path.join(codingAgentPath, 'config.yml'), 'config');

            await registry.uninstallAgent('coding-agent', true);

            expect(fs.existsSync(codingAgentPath)).toBe(false);
        });

        it('maintains other agents when removing one', async () => {
            const agent1Path = path.join(agentsDir, 'keep-me');
            const agent2Path = path.join(agentsDir, 'remove-me');

            fs.mkdirSync(agent1Path);
            fs.mkdirSync(agent2Path);
            fs.writeFileSync(path.join(agent1Path, 'config.yml'), 'keep');
            fs.writeFileSync(path.join(agent2Path, 'config.yml'), 'remove');

            await registry.uninstallAgent('remove-me');

            expect(fs.existsSync(agent1Path)).toBe(true);
            expect(fs.existsSync(agent2Path)).toBe(false);
            expect(fs.readFileSync(path.join(agent1Path, 'config.yml'), 'utf-8')).toBe('keep');
        });
    });

    describe('install and uninstall integration', () => {
        it('can install then uninstall an agent', async () => {
            // Create bundled agent file
            const bundledPath = path.join(tempDir, 'bundled', 'agents', 'test-agent.yml');
            fs.mkdirSync(path.dirname(bundledPath), { recursive: true });
            fs.writeFileSync(bundledPath, 'name: test-agent\ndescription: Test');

            mockResolveBundledScript
                .mockReturnValueOnce(path.join(tempDir, 'user-agent-registry.json'))
                .mockReturnValueOnce(bundledPath);

            // Install agent
            const configPath = await registry.installAgent('test-agent');
            const installedPath = path.join(tempDir, 'global', 'agents', 'test-agent');
            expect(configPath).toBe(path.join(installedPath, 'test-agent.yml'));

            // Verify installation
            expect(fs.existsSync(installedPath)).toBe(true);
            const installed = await registry.getInstalledAgents();
            expect(installed).toContain('test-agent');

            // Uninstall agent
            await registry.uninstallAgent('test-agent');

            // Verify removal
            expect(fs.existsSync(installedPath)).toBe(false);
            const installedAfter = await registry.getInstalledAgents();
            expect(installedAfter).not.toContain('test-agent');
        });
    });
});
