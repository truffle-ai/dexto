import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { LocalAgentRegistry } from './registry.js';
import { RegistryErrorCode } from './error-codes.js';
import { ErrorScope, ErrorType } from '@core/errors/types.js';

// Mock dependencies
vi.mock('@core/utils/path.js');
vi.mock('@core/preferences/loader.js');
vi.mock('@core/config/writer.js');
vi.mock('@core/logger/index.js', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

describe('LocalAgentRegistry', () => {
    let tempDir: string;
    let registry: LocalAgentRegistry;
    let mockResolveBundledScript: any;
    let mockGetDextoGlobalPath: any;
    let mockLoadGlobalPreferences: any;
    let mockWritePreferencesToAgent: any;

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
        const pathUtils = await import('@core/utils/path.js');
        const prefUtils = await import('@core/preferences/loader.js');
        const writerUtils = await import('@core/config/writer.js');

        mockResolveBundledScript = vi.mocked(pathUtils.resolveBundledScript);
        mockGetDextoGlobalPath = vi.mocked(pathUtils.getDextoGlobalPath);
        mockLoadGlobalPreferences = vi.mocked(prefUtils.loadGlobalPreferences);
        mockWritePreferencesToAgent = vi.mocked(writerUtils.writePreferencesToAgent);

        // Setup registry file
        const registryPath = path.join(tempDir, 'agent-registry.json');
        createRegistryFile(registryPath, {
            'test-agent': {
                description: 'Test agent',
                author: 'Test',
                tags: ['test'],
                source: 'test-agent.yml',
            },
            'dir-agent': {
                description: 'Directory agent',
                author: 'Test',
                tags: ['test'],
                source: 'dir-agent/',
                main: 'main.yml',
            },
        });

        // Mock path functions
        mockResolveBundledScript.mockReturnValue(registryPath);
        mockGetDextoGlobalPath.mockImplementation((subpath: string) =>
            path.join(tempDir, 'global', subpath)
        );

        // Mock preferences
        mockLoadGlobalPreferences.mockResolvedValue({
            llm: { provider: 'openai', model: 'gpt-4o', apiKey: '$OPENAI_API_KEY' },
        });
        mockWritePreferencesToAgent.mockResolvedValue(undefined);

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
                    description: 'Test agent',
                    author: 'Test',
                    tags: ['test'],
                    source: 'test-agent.yml',
                },
                'dir-agent': {
                    description: 'Directory agent',
                    author: 'Test',
                    tags: ['test'],
                    source: 'dir-agent/',
                    main: 'main.yml',
                },
            });

            // Should have correct number of agents
            expect(Object.keys(agents)).toHaveLength(2);
        });
    });

    describe('getRegistry', () => {
        it('returns parsed registry data with correct structure', () => {
            const registryData = registry.getRegistry();

            expect(registryData).toEqual({
                version: '1.0.0',
                agents: {
                    'test-agent': {
                        description: 'Test agent',
                        author: 'Test',
                        tags: ['test'],
                        source: 'test-agent.yml',
                    },
                    'dir-agent': {
                        description: 'Directory agent',
                        author: 'Test',
                        tags: ['test'],
                        source: 'dir-agent/',
                        main: 'main.yml',
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
            await expect(registry.installAgent('unknown-agent', true)).rejects.toMatchObject({
                code: RegistryErrorCode.AGENT_NOT_FOUND,
                scope: ErrorScope.AGENT_REGISTRY,
                type: ErrorType.USER,
                context: {
                    agentName: 'unknown-agent',
                    availableAgents: expect.arrayContaining(['test-agent', 'dir-agent']),
                },
            });
        });

        it('installs single-file agent and applies preferences when requested', async () => {
            // Create the bundled agent file
            const bundledAgentsPath = path.join(tempDir, 'bundled', 'agents');
            fs.mkdirSync(bundledAgentsPath, { recursive: true });
            fs.writeFileSync(
                path.join(bundledAgentsPath, 'test-agent.yml'),
                'llm:\n  provider: anthropic\n  model: claude-3-5-sonnet'
            );

            // Mock resolveBundledScript to return our test files
            mockResolveBundledScript.mockImplementation((relativePath: string) => {
                if (relativePath === 'agents/test-agent.yml') {
                    return path.join(bundledAgentsPath, 'test-agent.yml');
                }
                // Return original registry path
                return path.join(tempDir, 'agent-registry.json');
            });

            // Create a fresh registry instance to pick up the new mock
            const freshRegistry = new LocalAgentRegistry();
            const result = await freshRegistry.installAgent('test-agent', true);

            // Should return path to installed config
            expect(result).toMatch(/test-agent\.yml$/);
            expect(fs.existsSync(result)).toBe(true);

            // Verify the file was actually copied
            const installedContent = fs.readFileSync(result, 'utf-8');
            expect(installedContent).toContain('provider: anthropic');

            // Should have called preferences injection with the directory path
            const installedDir = path.dirname(result);
            expect(mockWritePreferencesToAgent).toHaveBeenCalledWith(
                installedDir,
                expect.objectContaining({
                    llm: { provider: 'openai', model: 'gpt-4o', apiKey: '$OPENAI_API_KEY' },
                })
            );
        });

        it('installs agent without preferences when not requested', async () => {
            // Create the bundled agent file
            const bundledAgentsPath = path.join(tempDir, 'bundled', 'agents');
            fs.mkdirSync(bundledAgentsPath, { recursive: true });
            fs.writeFileSync(
                path.join(bundledAgentsPath, 'test-agent.yml'),
                'llm:\n  provider: anthropic\n  model: claude-3-5-sonnet'
            );

            // Mock resolveBundledScript
            mockResolveBundledScript.mockImplementation((relativePath: string) => {
                if (relativePath === 'agents/test-agent.yml') {
                    return path.join(bundledAgentsPath, 'test-agent.yml');
                }
                return path.join(tempDir, 'agent-registry.json');
            });

            // Create fresh registry
            const freshRegistry = new LocalAgentRegistry();
            const result = await freshRegistry.installAgent('test-agent', false);

            // Should return path to installed config
            expect(result).toMatch(/test-agent\.yml$/);
            expect(fs.existsSync(result)).toBe(true);

            // Verify the file was actually copied
            const installedContent = fs.readFileSync(result, 'utf-8');
            expect(installedContent).toContain('provider: anthropic');

            // Should NOT have called preferences injection
            expect(mockWritePreferencesToAgent).not.toHaveBeenCalled();
        });

        it('installs directory agent with main config file', async () => {
            // Create directory agent structure
            const bundledAgentsPath = path.join(tempDir, 'bundled', 'agents');
            const dirAgentPath = path.join(bundledAgentsPath, 'dir-agent');
            fs.mkdirSync(dirAgentPath, { recursive: true });
            fs.writeFileSync(
                path.join(dirAgentPath, 'main.yml'),
                'llm:\n  provider: openai\n  model: gpt-4o'
            );
            fs.writeFileSync(path.join(dirAgentPath, 'extra.md'), '# Documentation');

            // We also need to mock copyDirectory since it's used for directory agents
            const pathUtils = await import('@core/utils/path.js');
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
                return path.join(tempDir, 'agent-registry.json');
            });

            // Create fresh registry
            const freshRegistry = new LocalAgentRegistry();
            const result = await freshRegistry.installAgent('dir-agent', true);

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

            // Should have called preferences injection on the directory
            expect(mockWritePreferencesToAgent).toHaveBeenCalledWith(
                installedDirPath,
                expect.objectContaining({
                    llm: { provider: 'openai', model: 'gpt-4o', apiKey: '$OPENAI_API_KEY' },
                })
            );
        });
    });

    describe('resolveAgent', () => {
        it('throws structured RegistryError for unknown agent with complete error properties', async () => {
            await expect(registry.resolveAgent('unknown-agent')).rejects.toMatchObject({
                code: RegistryErrorCode.AGENT_NOT_FOUND,
                scope: ErrorScope.AGENT_REGISTRY,
                type: ErrorType.USER,
                context: {
                    agentName: 'unknown-agent',
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
                    scope: ErrorScope.AGENT_REGISTRY,
                    type: ErrorType.SYSTEM,
                    context: {
                        agentName: 'bad-dir-agent',
                        reason: 'directory entry missing main field',
                    },
                })
            );
        });
    });
});
