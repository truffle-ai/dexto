import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import {
    loadUserRegistry,
    saveUserRegistry,
    mergeRegistries,
    addAgentToUserRegistry,
    removeAgentFromUserRegistry,
    userRegistryHasAgent,
    getUserRegistryPath,
} from './user-registry.js';
import type { Registry, AgentRegistryEntry } from './types.js';

vi.mock('../utils/path.js');
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

describe('user-registry', () => {
    let tempDir: string;
    let mockGetDextoGlobalPath: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        tempDir = fs.mkdtempSync(path.join(tmpdir(), 'user-registry-test-'));

        const pathUtils = await import('../utils/path.js');
        mockGetDextoGlobalPath = vi.mocked(pathUtils.getDextoGlobalPath);
        mockGetDextoGlobalPath.mockImplementation((type: string, filename?: string) => {
            if (filename) {
                return path.join(tempDir, filename);
            }
            return tempDir;
        });
    });

    afterEach(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    describe('getUserRegistryPath', () => {
        it('should return correct path', () => {
            const registryPath = getUserRegistryPath();
            expect(registryPath).toBe(path.join(tempDir, 'user-agent-registry.json'));
        });
    });

    describe('loadUserRegistry', () => {
        it('should return empty registry if file does not exist', () => {
            const registry = loadUserRegistry();
            expect(registry).toEqual({ version: '1.0.0', agents: {} });
        });

        it('should load existing user registry', () => {
            const userRegistry: Registry = {
                version: '1.0.0',
                agents: {
                    'custom-agent': {
                        id: 'custom-agent',
                        name: 'Custom Agent',
                        description: 'Custom agent',
                        author: 'User',
                        tags: ['custom'],
                        source: 'custom-agent/',
                        type: 'custom',
                    },
                },
            };

            fs.writeFileSync(getUserRegistryPath(), JSON.stringify(userRegistry));

            const loaded = loadUserRegistry();
            expect(loaded).toEqual(userRegistry);
        });

        it('should throw error if registry is invalid JSON', () => {
            fs.writeFileSync(getUserRegistryPath(), 'invalid json');

            expect(() => loadUserRegistry()).toThrow();
        });
    });

    describe('saveUserRegistry', () => {
        it('should save user registry atomically', async () => {
            const registry: Registry = {
                version: '1.0.0',
                agents: {
                    'test-agent': {
                        id: 'test-agent',
                        name: 'Test Agent',
                        description: 'Test',
                        author: 'User',
                        tags: [],
                        source: 'test-agent.yml',
                        type: 'custom',
                    },
                },
            };

            await saveUserRegistry(registry);

            const registryPath = getUserRegistryPath();
            expect(fs.existsSync(registryPath)).toBe(true);

            const loaded = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
            expect(loaded).toEqual(registry);
        });

        it('should create directory if it does not exist', async () => {
            // Remove temp dir to test creation
            fs.rmSync(tempDir, { recursive: true, force: true });

            const registry: Registry = { version: '1.0.0', agents: {} };
            await saveUserRegistry(registry);

            expect(fs.existsSync(getUserRegistryPath())).toBe(true);
        });
    });

    describe('mergeRegistries', () => {
        it('should merge bundled and user registries', () => {
            const bundled: Registry = {
                version: '1.0.0',
                agents: {
                    'builtin-agent': {
                        id: 'builtin-agent',
                        name: 'Builtin Agent',
                        description: 'Builtin',
                        author: 'Dexto',
                        tags: [],
                        source: 'builtin.yml',
                        type: 'builtin',
                    },
                },
            };

            const user: Registry = {
                version: '1.0.0',
                agents: {
                    'custom-agent': {
                        id: 'custom-agent',
                        name: 'Custom Agent',
                        description: 'Custom',
                        author: 'User',
                        tags: [],
                        source: 'custom.yml',
                        type: 'custom',
                    },
                },
            };

            const merged = mergeRegistries(bundled, user);

            expect(merged.agents).toHaveProperty('builtin-agent');
            expect(merged.agents).toHaveProperty('custom-agent');
            expect(Object.keys(merged.agents)).toHaveLength(2);
        });

        it('should use bundled version number', () => {
            const bundled: Registry = { version: '2.0.0', agents: {} };
            const user: Registry = { version: '1.0.0', agents: {} };

            const merged = mergeRegistries(bundled, user);
            expect(merged.version).toBe('2.0.0');
        });
    });

    describe('userRegistryHasAgent', () => {
        it('should return false if user registry is empty', () => {
            expect(userRegistryHasAgent('nonexistent')).toBe(false);
        });

        it('should return true if agent exists in user registry', async () => {
            const entry: AgentRegistryEntry = {
                id: 'my-agent',
                name: 'My Agent',
                description: 'Test',
                author: 'User',
                tags: [],
                source: 'test.yml',
                type: 'custom',
            };

            await addAgentToUserRegistry('test-agent', entry);

            expect(userRegistryHasAgent('test-agent')).toBe(true);
        });
    });

    describe('addAgentToUserRegistry', () => {
        it('should add custom agent to user registry', async () => {
            const entry: Omit<AgentRegistryEntry, 'type'> = {
                id: 'my-agent',
                name: 'My Agent',
                description: 'My custom agent',
                author: 'John Doe',
                tags: ['custom', 'coding'],
                source: 'my-agent/',
                main: 'agent.yml',
            };

            await addAgentToUserRegistry('my-agent', entry);

            const registry = loadUserRegistry();
            expect(registry.agents['my-agent']).toEqual({
                ...entry,
                type: 'custom',
            });
        });

        it('should throw error if agent already exists', async () => {
            const entry: Omit<AgentRegistryEntry, 'type'> = {
                id: 'test-agent',
                name: 'Test Agent',
                description: 'Test',
                author: 'User',
                tags: [],
                source: 'test.yml',
            };

            await addAgentToUserRegistry('test-agent', entry);

            await expect(addAgentToUserRegistry('test-agent', entry)).rejects.toThrow();
        });
    });

    describe('removeAgentFromUserRegistry', () => {
        it('should remove agent from user registry', async () => {
            const entry: Omit<AgentRegistryEntry, 'type'> = {
                id: 'test-agent',
                name: 'Test Agent',
                description: 'Test',
                author: 'User',
                tags: [],
                source: 'test.yml',
            };

            await addAgentToUserRegistry('test-agent', entry);
            expect(userRegistryHasAgent('test-agent')).toBe(true);

            await removeAgentFromUserRegistry('test-agent');
            expect(userRegistryHasAgent('test-agent')).toBe(false);
        });

        it('should throw error if agent does not exist', async () => {
            await expect(removeAgentFromUserRegistry('nonexistent')).rejects.toThrow();
        });
    });
});
