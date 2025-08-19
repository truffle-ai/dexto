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
        it('returns list of agent names from registry', () => {
            const agents = registry.getAvailableAgents();
            expect(agents).toEqual(expect.arrayContaining(['test-agent', 'dir-agent']));
            expect(agents).toHaveLength(2);
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
