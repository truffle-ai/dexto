import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs, mkdtempSync } from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { resolveAgentPath, updateDefaultAgentPreference } from './agent-resolver.js';
import { ConfigError } from './errors.js';

// Mock dependencies
vi.mock('@core/utils/execution-context.js');
vi.mock('@core/preferences/loader.js');
vi.mock('@core/agent-registry/registry.js');
vi.mock('@core/logger/index.js', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

const mockGetExecutionContext = vi.fn();
const mockGetDextoProjectRoot = vi.fn();
const mockGlobalPreferencesExist = vi.fn();
const mockLoadGlobalPreferences = vi.fn();
const mockUpdateGlobalPreferences = vi.fn();
const mockGetAgentRegistry = vi.fn();
// Import mocked modules
vi.mocked(await import('@core/utils/execution-context.js')).getExecutionContext =
    mockGetExecutionContext;
vi.mocked(await import('@core/utils/execution-context.js')).getDextoProjectRoot =
    mockGetDextoProjectRoot;
vi.mocked(await import('@core/preferences/loader.js')).globalPreferencesExist =
    mockGlobalPreferencesExist;
vi.mocked(await import('@core/preferences/loader.js')).loadGlobalPreferences =
    mockLoadGlobalPreferences;
vi.mocked(await import('@core/preferences/loader.js')).updateGlobalPreferences =
    mockUpdateGlobalPreferences;
vi.mocked(await import('@core/agent-registry/registry.js')).getAgentRegistry = mockGetAgentRegistry;

function createTempDir() {
    return mkdtempSync(path.join(tmpdir(), 'agent-resolver-test-'));
}

describe('Agent Resolver', () => {
    let tempDir: string;
    let mockRegistry: any;

    beforeEach(() => {
        tempDir = createTempDir();

        // Reset all mocks
        vi.clearAllMocks();

        // Setup default registry mock
        mockRegistry = {
            resolveAgent: vi.fn(),
        };
        mockGetAgentRegistry.mockReturnValue(mockRegistry);
    });

    afterEach(async () => {
        if (tempDir) {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });

    describe('resolveAgentPath - Explicit File Paths', () => {
        it('resolves existing absolute file path', async () => {
            const configFile = path.join(tempDir, 'agent.yml');
            await fs.writeFile(configFile, 'test: config');

            const result = await resolveAgentPath(configFile);
            expect(result).toBe(configFile);
        });

        it('resolves existing relative file path', async () => {
            const configFile = path.join(tempDir, 'agent.yml');
            await fs.writeFile(configFile, 'test: config');

            const originalCwd = process.cwd();
            process.chdir(tempDir);
            try {
                const relativePath = './agent.yml';
                const expectedPath = path.resolve(relativePath);
                const result = await resolveAgentPath(relativePath);
                expect(result).toBe(expectedPath);
            } finally {
                process.chdir(originalCwd);
            }
        });

        it('throws error for non-existent file path', async () => {
            const nonExistentFile = path.join(tempDir, 'missing.yml');

            await expect(resolveAgentPath(nonExistentFile)).rejects.toThrow();
        });

        it('recognizes .yml extension as file path', async () => {
            const configFile = path.join(tempDir, 'config.yml');
            await fs.writeFile(configFile, 'test: config');

            const result = await resolveAgentPath(configFile);
            expect(result).toBe(configFile);
        });

        it('recognizes path separators as file path', async () => {
            const configFile = path.join(tempDir, 'subdir', 'agent.yml');
            await fs.mkdir(path.dirname(configFile), { recursive: true });
            await fs.writeFile(configFile, 'test: config');

            const result = await resolveAgentPath(configFile);
            expect(result).toBe(configFile);
        });
    });

    describe('resolveAgentPath - Registry Names', () => {
        it('resolves valid registry agent name', async () => {
            const expectedPath = '/path/to/agent.yml';
            mockRegistry.resolveAgent.mockResolvedValue(expectedPath);

            const result = await resolveAgentPath('database-agent');

            expect(mockRegistry.resolveAgent).toHaveBeenCalledWith('database-agent');
            expect(result).toBe(expectedPath);
        });

        it('throws error for invalid registry agent name', async () => {
            mockRegistry.resolveAgent.mockRejectedValue(new Error('Agent not found'));

            await expect(resolveAgentPath('non-existent-agent')).rejects.toThrow('Agent not found');
        });
    });

    describe('resolveAgentPath - Default Resolution - Dexto Source Context', () => {
        beforeEach(() => {
            mockGetExecutionContext.mockReturnValue('dexto-source');
        });

        it('resolves bundled agent when exists', async () => {
            const bundledPath = path.resolve('agents/default-agent.yml');

            // Mock fs.access to succeed
            vi.spyOn(fs, 'access').mockResolvedValue(undefined);

            const result = await resolveAgentPath();
            expect(result).toBe(bundledPath);
        });

        it('throws error when bundled agent missing', async () => {
            // Mock fs.access to fail
            vi.spyOn(fs, 'access').mockRejectedValue(new Error('File not found'));

            await expect(resolveAgentPath()).rejects.toThrow();
        });
    });

    describe('resolveAgentPath - Default Resolution - Dexto Project Context', () => {
        beforeEach(() => {
            mockGetExecutionContext.mockReturnValue('dexto-project');
            mockGetDextoProjectRoot.mockReturnValue(tempDir);
        });

        it('uses project-local default-agent.yml when exists', async () => {
            const projectDefault = path.join(tempDir, 'default-agent.yml');
            await fs.writeFile(projectDefault, 'test: config');

            // Mock fs.access to succeed for the project default file
            const mockAccess = vi.spyOn(fs, 'access').mockImplementation(async (filePath) => {
                if (filePath === projectDefault) {
                    return Promise.resolve();
                }
                throw new Error('File not found');
            });

            const result = await resolveAgentPath();
            expect(result).toBe(projectDefault);

            mockAccess.mockRestore();
        });

        it('falls back to preferences when no project default', async () => {
            // No project default file
            mockGlobalPreferencesExist.mockReturnValue(true);
            mockLoadGlobalPreferences.mockResolvedValue({
                setup: { completed: true },
                defaults: { defaultAgent: 'my-agent' },
            });
            mockRegistry.resolveAgent.mockResolvedValue('/path/to/my-agent.yml');

            const result = await resolveAgentPath();

            expect(mockRegistry.resolveAgent).toHaveBeenCalledWith('my-agent');
            expect(result).toBe('/path/to/my-agent.yml');
        });

        it('throws error when no project default and no preferences', async () => {
            // No project default file
            mockGlobalPreferencesExist.mockReturnValue(false);

            await expect(resolveAgentPath()).rejects.toThrow();
        });

        it('throws error when preferences setup incomplete', async () => {
            // No project default file
            mockGlobalPreferencesExist.mockReturnValue(true);
            mockLoadGlobalPreferences.mockResolvedValue({
                setup: { completed: false },
                defaults: { defaultAgent: 'my-agent' },
            });

            await expect(resolveAgentPath()).rejects.toThrow();
        });
    });

    describe('resolveAgentPath - Default Resolution - Global CLI Context', () => {
        beforeEach(() => {
            mockGetExecutionContext.mockReturnValue('global-cli');
        });

        it('resolves using preferences default agent', async () => {
            mockGlobalPreferencesExist.mockReturnValue(true);
            mockLoadGlobalPreferences.mockResolvedValue({
                setup: { completed: true },
                defaults: { defaultAgent: 'my-default' },
            });
            mockRegistry.resolveAgent.mockResolvedValue('/path/to/my-default.yml');

            const result = await resolveAgentPath();

            expect(mockRegistry.resolveAgent).toHaveBeenCalledWith('my-default');
            expect(result).toBe('/path/to/my-default.yml');
        });

        it('throws error when no preferences exist', async () => {
            mockGlobalPreferencesExist.mockReturnValue(false);

            await expect(resolveAgentPath()).rejects.toThrow();
        });

        it('throws error when setup incomplete', async () => {
            mockGlobalPreferencesExist.mockReturnValue(true);
            mockLoadGlobalPreferences.mockResolvedValue({
                setup: { completed: false },
                defaults: { defaultAgent: 'my-agent' },
            });

            await expect(resolveAgentPath()).rejects.toThrow();
        });
    });

    describe('resolveAgentPath - Unknown Execution Context', () => {
        it('throws error for unknown execution context', async () => {
            mockGetExecutionContext.mockReturnValue('unknown-context');

            await expect(resolveAgentPath()).rejects.toThrow();
        });
    });

    describe('updateDefaultAgentPreference', () => {
        it('updates preference for valid agent', async () => {
            mockRegistry.resolveAgent.mockResolvedValue('/path/to/agent.yml');
            mockUpdateGlobalPreferences.mockResolvedValue(undefined);

            await updateDefaultAgentPreference('my-agent');

            expect(mockRegistry.resolveAgent).toHaveBeenCalledWith('my-agent');
            expect(mockUpdateGlobalPreferences).toHaveBeenCalledWith({
                defaults: { defaultAgent: 'my-agent' },
            });
        });

        it('throws error for invalid agent', async () => {
            mockRegistry.resolveAgent.mockRejectedValue(new Error('Agent not found'));

            await expect(updateDefaultAgentPreference('invalid-agent')).rejects.toThrow(
                'Agent not found'
            );

            expect(mockUpdateGlobalPreferences).not.toHaveBeenCalled();
        });

        it('throws error when preference update fails', async () => {
            mockRegistry.resolveAgent.mockResolvedValue('/path/to/agent.yml');
            mockUpdateGlobalPreferences.mockRejectedValue(new Error('Update failed'));

            await expect(updateDefaultAgentPreference('my-agent')).rejects.toThrow('Update failed');
        });
    });
});
