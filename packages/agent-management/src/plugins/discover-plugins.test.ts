import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';

// Mock fs module
vi.mock('fs', async () => {
    const actual = await vi.importActual<typeof import('fs')>('fs');
    return {
        ...actual,
        readdirSync: vi.fn(),
        existsSync: vi.fn(),
        readFileSync: vi.fn(),
    };
});

// Mock path utilities
vi.mock('../utils/path.js', () => ({
    getDextoGlobalPath: vi.fn((type: string, filename?: string) =>
        filename ? `/home/user/.dexto/${type}/${filename}` : `/home/user/.dexto/${type}`
    ),
}));

import { discoverClaudeCodePlugins, getPluginSearchPaths } from './discover-plugins.js';
import { getDextoGlobalPath } from '../utils/path.js';

describe('discoverClaudeCodePlugins', () => {
    const originalCwd = process.cwd;
    const originalEnv = { ...process.env };

    // Helper to create mock Dirent-like objects for testing
    const createDirent = (name: string, isDir: boolean) => ({
        name,
        isFile: () => !isDir,
        isDirectory: () => isDir,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isSymbolicLink: () => false,
        isFIFO: () => false,
        isSocket: () => false,
        path: '',
        parentPath: '',
    });

    beforeEach(() => {
        vi.mocked(fs.readdirSync).mockReset();
        vi.mocked(fs.existsSync).mockReset();
        vi.mocked(fs.readFileSync).mockReset();
        vi.mocked(getDextoGlobalPath).mockReset();

        // Default mocks
        process.cwd = vi.fn(() => '/test/project');
        process.env.HOME = '/home/user';
        vi.mocked(getDextoGlobalPath).mockImplementation((type: string, filename?: string) =>
            filename ? `/home/user/.dexto/${type}/${filename}` : `/home/user/.dexto/${type}`
        );
        vi.mocked(fs.existsSync).mockReturnValue(false);
    });

    afterEach(() => {
        process.cwd = originalCwd;
        process.env = { ...originalEnv };
    });

    describe('plugin discovery from project directories', () => {
        it('should discover plugins from <cwd>/.dexto/plugins/', () => {
            const manifestContent = JSON.stringify({
                name: 'test-plugin',
                description: 'A test plugin',
                version: '1.0.0',
            });

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/test/project/.dexto/plugins') return true;
                if (p === '/test/project/.dexto/plugins/my-plugin/.claude-plugin/plugin.json')
                    return true;
                return false;
            });

            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/test/project/.dexto/plugins') {
                    return [createDirent('my-plugin', true)] as any;
                }
                return [];
            });

            vi.mocked(fs.readFileSync).mockReturnValue(manifestContent);

            const result = discoverClaudeCodePlugins();

            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({
                path: '/test/project/.dexto/plugins/my-plugin',
                source: 'project',
                manifest: {
                    name: 'test-plugin',
                    description: 'A test plugin',
                    version: '1.0.0',
                },
            });
        });

        it('should discover plugins from <cwd>/.claude/plugins/', () => {
            const manifestContent = JSON.stringify({
                name: 'claude-plugin',
                description: 'A Claude Code plugin',
            });

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/test/project/.claude/plugins') return true;
                if (p === '/test/project/.claude/plugins/awesome-plugin/.claude-plugin/plugin.json')
                    return true;
                return false;
            });

            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/test/project/.claude/plugins') {
                    return [createDirent('awesome-plugin', true)] as any;
                }
                return [];
            });

            vi.mocked(fs.readFileSync).mockReturnValue(manifestContent);

            const result = discoverClaudeCodePlugins();

            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({
                path: '/test/project/.claude/plugins/awesome-plugin',
                source: 'project',
                manifest: {
                    name: 'claude-plugin',
                },
            });
        });
    });

    describe('plugin discovery from user directories', () => {
        it('should discover plugins from ~/.dexto/plugins/', () => {
            const manifestContent = JSON.stringify({
                name: 'user-plugin',
            });

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/home/user/.dexto/plugins') return true;
                if (p === '/home/user/.dexto/plugins/global-plugin/.claude-plugin/plugin.json')
                    return true;
                return false;
            });

            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/home/user/.dexto/plugins') {
                    return [createDirent('global-plugin', true)] as any;
                }
                return [];
            });

            vi.mocked(fs.readFileSync).mockReturnValue(manifestContent);

            const result = discoverClaudeCodePlugins();

            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({
                path: '/home/user/.dexto/plugins/global-plugin',
                source: 'user',
                manifest: {
                    name: 'user-plugin',
                },
            });
        });

        it('should discover plugins from ~/.claude/plugins/', () => {
            const manifestContent = JSON.stringify({
                name: 'claude-user-plugin',
            });

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/home/user/.claude/plugins') return true;
                if (p === '/home/user/.claude/plugins/claude-global/.claude-plugin/plugin.json')
                    return true;
                return false;
            });

            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/home/user/.claude/plugins') {
                    return [createDirent('claude-global', true)] as any;
                }
                return [];
            });

            vi.mocked(fs.readFileSync).mockReturnValue(manifestContent);

            const result = discoverClaudeCodePlugins();

            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({
                path: '/home/user/.claude/plugins/claude-global',
                source: 'user',
                manifest: {
                    name: 'claude-user-plugin',
                },
            });
        });
    });

    describe('deduplication by plugin name', () => {
        it('should deduplicate by plugin name (first found wins)', () => {
            const projectManifest = JSON.stringify({
                name: 'duplicate-plugin',
                description: 'Project version',
            });
            const userManifest = JSON.stringify({
                name: 'duplicate-plugin',
                description: 'User version',
            });

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/test/project/.dexto/plugins') return true;
                if (p === '/home/user/.dexto/plugins') return true;
                if (p === '/test/project/.dexto/plugins/plugin-a/.claude-plugin/plugin.json')
                    return true;
                if (p === '/home/user/.dexto/plugins/plugin-b/.claude-plugin/plugin.json')
                    return true;
                return false;
            });

            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/test/project/.dexto/plugins') {
                    return [createDirent('plugin-a', true)] as any;
                }
                if (dir === '/home/user/.dexto/plugins') {
                    return [createDirent('plugin-b', true)] as any;
                }
                return [];
            });

            vi.mocked(fs.readFileSync).mockImplementation((p) => {
                if (String(p).includes('plugin-a')) return projectManifest;
                if (String(p).includes('plugin-b')) return userManifest;
                return '';
            });

            const result = discoverClaudeCodePlugins();

            // Should only have one plugin - the project version (first found)
            expect(result).toHaveLength(1);
            expect(result[0]!.manifest.description).toBe('Project version');
            expect(result[0]!.source).toBe('project');
        });

        it('should be case-insensitive when deduplicating', () => {
            const manifest1 = JSON.stringify({ name: 'My-Plugin' });
            const manifest2 = JSON.stringify({ name: 'my-plugin' }); // Different case

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/test/project/.dexto/plugins') return true;
                if (p === '/test/project/.claude/plugins') return true;
                if (p === '/test/project/.dexto/plugins/plugin1/.claude-plugin/plugin.json')
                    return true;
                if (p === '/test/project/.claude/plugins/plugin2/.claude-plugin/plugin.json')
                    return true;
                return false;
            });

            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/test/project/.dexto/plugins') {
                    return [createDirent('plugin1', true)] as any;
                }
                if (dir === '/test/project/.claude/plugins') {
                    return [createDirent('plugin2', true)] as any;
                }
                return [];
            });

            vi.mocked(fs.readFileSync).mockImplementation((p) => {
                if (String(p).includes('plugin1')) return manifest1;
                if (String(p).includes('plugin2')) return manifest2;
                return '';
            });

            const result = discoverClaudeCodePlugins();

            // Should only have one plugin - case-insensitive dedup
            expect(result).toHaveLength(1);
            expect(result[0]!.manifest.name).toBe('My-Plugin');
        });
    });

    describe('invalid manifests', () => {
        it('should skip plugins without plugin.json', () => {
            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/test/project/.dexto/plugins') return true;
                // No plugin.json exists
                return false;
            });

            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/test/project/.dexto/plugins') {
                    return [createDirent('incomplete-plugin', true)] as any;
                }
                return [];
            });

            const result = discoverClaudeCodePlugins();

            expect(result).toHaveLength(0);
        });

        it('should skip plugins with invalid JSON in manifest', () => {
            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/test/project/.dexto/plugins') return true;
                if (p === '/test/project/.dexto/plugins/bad-json/.claude-plugin/plugin.json')
                    return true;
                return false;
            });

            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/test/project/.dexto/plugins') {
                    return [createDirent('bad-json', true)] as any;
                }
                return [];
            });

            vi.mocked(fs.readFileSync).mockReturnValue('{ invalid json }');

            const result = discoverClaudeCodePlugins();

            expect(result).toHaveLength(0);
        });

        it('should skip manifests missing required name field silently', () => {
            // Note: Invalid manifests cause tryLoadManifest to throw PluginError,
            // but the error is caught in the scanPluginsDir try/catch and silently skipped.
            // This is intentional - we don't want one invalid plugin to prevent others from loading.
            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/test/project/.dexto/plugins') return true;
                if (p === '/test/project/.dexto/plugins/no-name/.claude-plugin/plugin.json')
                    return true;
                return false;
            });

            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/test/project/.dexto/plugins') {
                    return [createDirent('no-name', true)] as any;
                }
                return [];
            });

            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ description: 'No name' }));

            // Invalid manifests are silently skipped - result is empty
            const result = discoverClaudeCodePlugins();
            expect(result).toHaveLength(0);
        });
    });

    describe('edge cases', () => {
        it('should return empty array when no plugin directories exist', () => {
            vi.mocked(fs.existsSync).mockReturnValue(false);

            const result = discoverClaudeCodePlugins();

            expect(result).toEqual([]);
        });

        it('should skip non-directory entries in plugins folder', () => {
            const manifestContent = JSON.stringify({ name: 'valid-plugin' });

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/test/project/.dexto/plugins') return true;
                if (p === '/test/project/.dexto/plugins/valid-plugin/.claude-plugin/plugin.json')
                    return true;
                return false;
            });

            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/test/project/.dexto/plugins') {
                    return [
                        createDirent('valid-plugin', true),
                        createDirent('some-file.txt', false), // File, not directory
                    ] as any;
                }
                return [];
            });

            vi.mocked(fs.readFileSync).mockReturnValue(manifestContent);

            const result = discoverClaudeCodePlugins();

            expect(result).toHaveLength(1);
            expect(result[0]!.manifest.name).toBe('valid-plugin');
        });

        it('should handle missing HOME environment variable', () => {
            delete process.env.HOME;
            delete process.env.USERPROFILE;

            const manifestContent = JSON.stringify({ name: 'local-only' });

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/test/project/.dexto/plugins') return true;
                if (p === '/test/project/.dexto/plugins/local/.claude-plugin/plugin.json')
                    return true;
                return false;
            });

            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/test/project/.dexto/plugins') {
                    return [createDirent('local', true)] as any;
                }
                return [];
            });

            vi.mocked(fs.readFileSync).mockReturnValue(manifestContent);

            const result = discoverClaudeCodePlugins();

            // Should still work for local plugins
            expect(result).toHaveLength(1);
        });
    });

    describe('installed_plugins.json reading', () => {
        it('should discover plugins from installed_plugins.json', () => {
            const installedPluginsJson = JSON.stringify({
                version: 2,
                plugins: {
                    'code-review@claude-code-plugins': [
                        {
                            scope: 'user',
                            installPath:
                                '/home/user/.claude/plugins/cache/claude-code-plugins/code-review/1.0.0',
                            version: '1.0.0',
                        },
                    ],
                },
            });

            const manifestContent = JSON.stringify({
                name: 'code-review',
                version: '1.0.0',
                description: 'Code review plugin',
            });

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/home/user/.claude/plugins/installed_plugins.json') return true;
                if (p === '/home/user/.claude/plugins/cache/claude-code-plugins/code-review/1.0.0')
                    return true;
                if (
                    p ===
                    '/home/user/.claude/plugins/cache/claude-code-plugins/code-review/1.0.0/.claude-plugin/plugin.json'
                )
                    return true;
                return false;
            });

            vi.mocked(fs.readFileSync).mockImplementation((p) => {
                if (p === '/home/user/.claude/plugins/installed_plugins.json') {
                    return installedPluginsJson;
                }
                return manifestContent;
            });

            vi.mocked(fs.readdirSync).mockReturnValue([]);

            const result = discoverClaudeCodePlugins();

            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({
                path: '/home/user/.claude/plugins/cache/claude-code-plugins/code-review/1.0.0',
                manifest: {
                    name: 'code-review',
                    version: '1.0.0',
                },
                source: 'user',
            });
        });

        it('should filter project-scoped plugins by current project path', () => {
            const installedPluginsJson = JSON.stringify({
                version: 2,
                plugins: {
                    'my-plugin@marketplace': [
                        {
                            scope: 'project',
                            installPath:
                                '/home/user/.claude/plugins/cache/marketplace/my-plugin/1.0.0',
                            version: '1.0.0',
                            projectPath: '/test/project', // Matches current project
                        },
                        {
                            scope: 'project',
                            installPath:
                                '/home/user/.claude/plugins/cache/marketplace/my-plugin/1.0.0',
                            version: '1.0.0',
                            projectPath: '/other/project', // Different project
                        },
                    ],
                },
            });

            const manifestContent = JSON.stringify({
                name: 'my-plugin',
                version: '1.0.0',
            });

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/home/user/.claude/plugins/installed_plugins.json') return true;
                if (p === '/home/user/.claude/plugins/cache/marketplace/my-plugin/1.0.0')
                    return true;
                if (
                    p ===
                    '/home/user/.claude/plugins/cache/marketplace/my-plugin/1.0.0/.claude-plugin/plugin.json'
                )
                    return true;
                return false;
            });

            vi.mocked(fs.readFileSync).mockImplementation((p) => {
                if (p === '/home/user/.claude/plugins/installed_plugins.json') {
                    return installedPluginsJson;
                }
                return manifestContent;
            });

            vi.mocked(fs.readdirSync).mockReturnValue([]);

            const result = discoverClaudeCodePlugins();

            // Should only include the plugin for the current project
            expect(result).toHaveLength(1);
            expect(result[0]!.source).toBe('project');
        });

        it('should filter local-scoped plugins by current project path', () => {
            const installedPluginsJson = JSON.stringify({
                version: 2,
                plugins: {
                    'local-plugin@marketplace': [
                        {
                            scope: 'local',
                            installPath:
                                '/home/user/.claude/plugins/cache/marketplace/local-plugin/1.0.0',
                            version: '1.0.0',
                            projectPath: '/other/project', // Different project - should be filtered out
                        },
                    ],
                    'user-plugin@marketplace': [
                        {
                            scope: 'user',
                            installPath:
                                '/home/user/.claude/plugins/cache/marketplace/user-plugin/1.0.0',
                            version: '1.0.0',
                            // No projectPath - user scope applies everywhere
                        },
                    ],
                },
            });

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/home/user/.claude/plugins/installed_plugins.json') return true;
                if (p === '/home/user/.claude/plugins/cache/marketplace/local-plugin/1.0.0')
                    return true;
                if (p === '/home/user/.claude/plugins/cache/marketplace/user-plugin/1.0.0')
                    return true;
                if (
                    p ===
                    '/home/user/.claude/plugins/cache/marketplace/local-plugin/1.0.0/.claude-plugin/plugin.json'
                )
                    return true;
                if (
                    p ===
                    '/home/user/.claude/plugins/cache/marketplace/user-plugin/1.0.0/.claude-plugin/plugin.json'
                )
                    return true;
                return false;
            });

            vi.mocked(fs.readFileSync).mockImplementation((p) => {
                if (p === '/home/user/.claude/plugins/installed_plugins.json') {
                    return installedPluginsJson;
                }
                if (String(p).includes('local-plugin')) {
                    return JSON.stringify({ name: 'local-plugin', version: '1.0.0' });
                }
                return JSON.stringify({ name: 'user-plugin', version: '1.0.0' });
            });

            vi.mocked(fs.readdirSync).mockReturnValue([]);

            const result = discoverClaudeCodePlugins();

            // Should only include the user-scoped plugin, not the local-scoped one for a different project
            expect(result).toHaveLength(1);
            expect(result[0]!.manifest.name).toBe('user-plugin');
            expect(result[0]!.source).toBe('user');
        });

        it('should skip cache and marketplaces directories in directory scan', () => {
            const manifestContent = JSON.stringify({ name: 'direct-plugin' });

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/home/user/.claude/plugins') return true;
                if (p === '/home/user/.claude/plugins/direct-plugin/.claude-plugin/plugin.json')
                    return true;
                return false;
            });

            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/home/user/.claude/plugins') {
                    return [
                        createDirent('cache', true), // Should be skipped
                        createDirent('marketplaces', true), // Should be skipped
                        createDirent('direct-plugin', true), // Should be scanned
                    ] as any;
                }
                return [];
            });

            vi.mocked(fs.readFileSync).mockReturnValue(manifestContent);

            const result = discoverClaudeCodePlugins();

            expect(result).toHaveLength(1);
            expect(result[0]!.manifest.name).toBe('direct-plugin');
        });
    });
});

describe('getPluginSearchPaths', () => {
    const originalCwd = process.cwd;
    const originalEnv = { ...process.env };

    beforeEach(() => {
        process.cwd = vi.fn(() => '/test/project');
        process.env.HOME = '/home/user';
        vi.mocked(getDextoGlobalPath).mockImplementation((type: string, filename?: string) =>
            filename ? `/home/user/.dexto/${type}/${filename}` : `/home/user/.dexto/${type}`
        );
    });

    afterEach(() => {
        process.cwd = originalCwd;
        process.env = { ...originalEnv };
    });

    it('should return all search paths in priority order', () => {
        const paths = getPluginSearchPaths();

        expect(paths).toEqual([
            // Dexto's installed_plugins.json (highest priority)
            '/home/user/.dexto/plugins/installed_plugins.json',
            // Claude Code's installed_plugins.json
            '/home/user/.claude/plugins/installed_plugins.json',
            // Directory scan locations
            '/test/project/.dexto/plugins',
            '/test/project/.claude/plugins',
            '/home/user/.dexto/plugins',
            '/home/user/.claude/plugins',
        ]);
    });
});
