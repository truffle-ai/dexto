import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { LocalAgentRegistry } from './registry.js';
import type { Registry } from './types.js';

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

vi.mock('../preferences/loader.js', () => ({
    loadGlobalPreferences: vi.fn().mockResolvedValue({
        defaults: { defaultAgent: 'default-agent' },
    }),
}));

vi.mock('../writer.js', () => ({
    writePreferencesToAgent: vi.fn().mockResolvedValue(undefined),
}));

describe('LocalAgentRegistry - Integration Tests', () => {
    let tempDir: string;
    let mockGetDextoGlobalPath: any;
    let mockResolveBundledScript: any;
    let registry: LocalAgentRegistry;

    beforeEach(async () => {
        vi.clearAllMocks();
        tempDir = fs.mkdtempSync(path.join(tmpdir(), 'registry-integ-test-'));

        // Create bundled registry
        const bundledRegistryDir = path.join(tempDir, 'bundled');
        fs.mkdirSync(bundledRegistryDir, { recursive: true });

        const bundledRegistry: Registry = {
            version: '1.0.0',
            agents: {
                'default-agent': {
                    id: 'default-agent',
                    name: 'Default Agent',
                    description: 'Default builtin agent',
                    author: 'Dexto',
                    tags: ['builtin'],
                    source: 'default-agent.yml',
                    type: 'builtin',
                },
                'coding-agent': {
                    id: 'coding-agent',
                    name: 'Coding Agent',
                    description: 'Coding builtin agent',
                    author: 'Dexto',
                    tags: ['builtin', 'coding'],
                    source: 'coding-agent/',
                    main: 'agent.yml',
                    type: 'builtin',
                },
            },
        };

        fs.writeFileSync(
            path.join(bundledRegistryDir, 'agent-registry.json'),
            JSON.stringify(bundledRegistry, null, 2)
        );

        // Create sample bundled agent files
        fs.writeFileSync(
            path.join(bundledRegistryDir, 'default-agent.yml'),
            'name: default-agent\nversion: 1.0.0'
        );

        const codingAgentDir = path.join(bundledRegistryDir, 'coding-agent');
        fs.mkdirSync(codingAgentDir, { recursive: true });
        fs.writeFileSync(
            path.join(codingAgentDir, 'agent.yml'),
            'name: coding-agent\nversion: 1.0.0'
        );

        // Mock path utilities
        const pathUtils = await import('../utils/path.js');
        mockGetDextoGlobalPath = vi.mocked(pathUtils.getDextoGlobalPath);
        mockGetDextoGlobalPath.mockImplementation((type: string, filename?: string) => {
            if (filename) {
                return path.join(tempDir, filename);
            }
            return path.join(tempDir, type);
        });

        mockResolveBundledScript = vi.mocked(pathUtils.resolveBundledScript);
        mockResolveBundledScript.mockImplementation((scriptPath: string) => {
            return path.join(bundledRegistryDir, scriptPath.replace('agents/', ''));
        });

        // Mock copyDirectory to use fs operations
        const mockCopyDirectory = vi.mocked(pathUtils.copyDirectory);
        mockCopyDirectory.mockImplementation(async (src: string, dest: string) => {
            // Simple recursive copy for testing
            const copyRecursive = async (source: string, destination: string) => {
                await fs.promises.mkdir(destination, { recursive: true });
                const entries = await fs.promises.readdir(source, { withFileTypes: true });

                for (const entry of entries) {
                    const srcPath = path.join(source, entry.name);
                    const destPath = path.join(destination, entry.name);

                    if (entry.isDirectory()) {
                        await copyRecursive(srcPath, destPath);
                    } else {
                        await fs.promises.copyFile(srcPath, destPath);
                    }
                }
            };

            await copyRecursive(src, dest);
        });

        registry = new LocalAgentRegistry();
    });

    afterEach(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    describe('Merged Registry', () => {
        it('should load bundled agents', () => {
            const agents = registry.getAvailableAgents();

            expect(agents).toHaveProperty('default-agent');
            expect(agents).toHaveProperty('coding-agent');
            expect(Object.keys(agents)).toHaveLength(2);
        });

        it('should merge bundled and custom agents', async () => {
            // Create a custom agent file
            const customAgentPath = path.join(tempDir, 'custom-test.yml');
            fs.writeFileSync(customAgentPath, 'name: custom-test\nversion: 1.0.0');

            // Install custom agent
            await registry.installCustomAgentFromPath('custom-test', customAgentPath, {
                description: 'Custom test agent',
                author: 'Test User',
                tags: ['custom'],
            });

            // Get merged registry
            const agents = registry.getAvailableAgents();

            expect(agents).toHaveProperty('default-agent');
            expect(agents).toHaveProperty('coding-agent');
            expect(agents).toHaveProperty('custom-test');
            expect(agents['custom-test']).toBeDefined();
            expect(agents['custom-test']!.type).toBe('custom');
            expect(Object.keys(agents)).toHaveLength(3);
        });
    });

    describe('Custom Agent Installation', () => {
        it('should install custom agent from YAML file', async () => {
            const customAgentPath = path.join(tempDir, 'my-agent.yml');
            fs.writeFileSync(customAgentPath, 'name: my-agent\nversion: 1.0.0');

            const mainConfigPath = await registry.installCustomAgentFromPath(
                'my-agent',
                customAgentPath,
                {
                    description: 'My custom agent',
                    author: 'John Doe',
                    tags: ['custom'],
                }
            );

            expect(fs.existsSync(mainConfigPath)).toBe(true);
            expect(registry.hasAgent('my-agent')).toBe(true);

            const agents = registry.getAvailableAgents();
            expect(agents['my-agent']).toBeDefined();
            expect(agents['my-agent']!.type).toBe('custom');
            expect(agents['my-agent']!.description).toBe('My custom agent');
        });

        it('should install custom agent from directory', async () => {
            const customAgentDir = path.join(tempDir, 'my-dir-agent');
            fs.mkdirSync(customAgentDir, { recursive: true });
            fs.writeFileSync(
                path.join(customAgentDir, 'agent.yml'),
                'name: my-dir-agent\nversion: 1.0.0'
            );
            fs.writeFileSync(path.join(customAgentDir, 'prompts.md'), '# Custom prompts');

            const mainConfigPath = await registry.installCustomAgentFromPath(
                'my-dir-agent',
                customAgentDir,
                {
                    description: 'Directory-based custom agent',
                    author: 'Jane Doe',
                    tags: ['custom', 'advanced'],
                    main: 'agent.yml',
                }
            );

            expect(fs.existsSync(mainConfigPath)).toBe(true);
            expect(registry.hasAgent('my-dir-agent')).toBe(true);

            // Verify all files copied
            const installedDir = path.dirname(mainConfigPath);
            expect(fs.existsSync(path.join(installedDir, 'prompts.md'))).toBe(true);
        });

        it('should throw error if directory agent missing main field', async () => {
            const customAgentDir = path.join(tempDir, 'missing-main-agent');
            fs.mkdirSync(customAgentDir, { recursive: true });
            fs.writeFileSync(
                path.join(customAgentDir, 'agent.yml'),
                'name: missing-main-agent\nversion: 1.0.0'
            );

            await expect(
                registry.installCustomAgentFromPath('missing-main-agent', customAgentDir, {
                    description: 'Directory agent without main field',
                    author: 'Test',
                    tags: ['test'],
                    // main field intentionally omitted
                })
            ).rejects.toThrow(
                "Failed to install agent 'missing-main-agent': main field is required for directory-based agents"
            );
        });

        it('should throw error if custom agent name conflicts with builtin', async () => {
            const customAgentPath = path.join(tempDir, 'default-agent.yml');
            fs.writeFileSync(customAgentPath, 'name: default-agent\nversion: 1.0.0');

            await expect(
                registry.installCustomAgentFromPath('default-agent', customAgentPath, {
                    description: 'Conflicting agent',
                    author: 'Test',
                    tags: [],
                })
            ).rejects.toThrow(/name conflicts with builtin agent/);
        });

        it('should throw error if agent already installed', async () => {
            const customAgentPath = path.join(tempDir, 'duplicate.yml');
            fs.writeFileSync(customAgentPath, 'name: duplicate\nversion: 1.0.0');

            await registry.installCustomAgentFromPath('duplicate', customAgentPath, {
                description: 'First install',
                author: 'Test',
                tags: [],
            });

            await expect(
                registry.installCustomAgentFromPath('duplicate', customAgentPath, {
                    description: 'Second install',
                    author: 'Test',
                    tags: [],
                })
            ).rejects.toThrow(/already exists/);
        });

        it('should throw error if source file does not exist', async () => {
            await expect(
                registry.installCustomAgentFromPath('nonexistent', '/nonexistent/path.yml', {
                    description: 'Test',
                    author: 'Test',
                    tags: [],
                })
            ).rejects.toThrow(/not found/);
        });
    });

    describe('Custom Agent Uninstallation', () => {
        it('should uninstall custom agent and remove from registry', async () => {
            const customAgentPath = path.join(tempDir, 'to-uninstall.yml');
            fs.writeFileSync(customAgentPath, 'name: to-uninstall\nversion: 1.0.0');

            await registry.installCustomAgentFromPath('to-uninstall', customAgentPath, {
                description: 'Will be uninstalled',
                author: 'Test',
                tags: [],
            });

            expect(registry.hasAgent('to-uninstall')).toBe(true);

            await registry.uninstallAgent('to-uninstall');

            expect(registry.hasAgent('to-uninstall')).toBe(false);
        });

        it('should not allow uninstalling default agent without force', async () => {
            // Install default-agent first
            await registry.installAgent('default-agent');

            await expect(registry.uninstallAgent('default-agent')).rejects.toThrow(/protected/);
        });

        it('should allow uninstalling default agent with force flag', async () => {
            await registry.installAgent('default-agent');

            await expect(registry.uninstallAgent('default-agent', true)).resolves.not.toThrow();
        });

        it('should throw error if agent not installed', async () => {
            await expect(registry.uninstallAgent('nonexistent')).rejects.toThrow(/not installed/);
        });
    });

    describe('Agent Resolution', () => {
        it('should resolve installed builtin agent', async () => {
            await registry.installAgent('default-agent');

            const configPath = await registry.resolveAgent('default-agent', false);

            expect(fs.existsSync(configPath)).toBe(true);
            expect(configPath).toContain('default-agent.yml');
        });

        it('should auto-install missing builtin agent', async () => {
            const configPath = await registry.resolveAgent('coding-agent', true);

            expect(fs.existsSync(configPath)).toBe(true);
            expect(registry.hasAgent('coding-agent')).toBe(true);
        });

        it('should resolve custom agent', async () => {
            const customAgentPath = path.join(tempDir, 'custom.yml');
            fs.writeFileSync(customAgentPath, 'name: custom\nversion: 1.0.0');

            await registry.installCustomAgentFromPath('custom', customAgentPath, {
                description: 'Custom',
                author: 'Test',
                tags: [],
            });

            const configPath = await registry.resolveAgent('custom', false);

            expect(fs.existsSync(configPath)).toBe(true);
        });
    });
});
