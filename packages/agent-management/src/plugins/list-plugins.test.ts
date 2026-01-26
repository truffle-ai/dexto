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

import { listInstalledPlugins } from './list-plugins.js';
import { getDextoGlobalPath } from '../utils/path.js';

describe('listInstalledPlugins', () => {
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

    describe('scope filtering', () => {
        it('should filter out project-scoped plugins from different projects', () => {
            const installedPluginsContent = JSON.stringify({
                version: 2,
                plugins: {
                    'test-plugin@test-marketplace': [
                        {
                            scope: 'local',
                            projectPath: '/different/project',
                            installPath: '/home/user/.dexto/plugins/cache/test/test-plugin/1.0.0',
                            version: '1.0.0',
                            installedAt: '2026-01-01T00:00:00.000Z',
                        },
                    ],
                },
            });

            const manifestContent = JSON.stringify({
                name: 'test-plugin',
                description: 'Test plugin',
                version: '1.0.0',
            });

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/home/user/.dexto/plugins/installed_plugins.json') return true;
                if (p === '/home/user/.dexto/plugins/cache/test/test-plugin/1.0.0') return true;
                if (
                    p ===
                    '/home/user/.dexto/plugins/cache/test/test-plugin/1.0.0/.claude-plugin/plugin.json'
                )
                    return true;
                return false;
            });

            vi.mocked(fs.readFileSync).mockImplementation((p) => {
                if (typeof p === 'string' && p.endsWith('installed_plugins.json')) {
                    return installedPluginsContent;
                }
                if (typeof p === 'string' && p.endsWith('plugin.json')) {
                    return manifestContent;
                }
                return '';
            });

            const result = listInstalledPlugins('/test/project');

            // Should be filtered out because projectPath doesn't match
            expect(result).toHaveLength(0);
        });

        it('should include user-scoped plugins regardless of project', () => {
            const installedPluginsContent = JSON.stringify({
                version: 2,
                plugins: {
                    'test-plugin@test-marketplace': [
                        {
                            scope: 'user',
                            installPath: '/home/user/.dexto/plugins/cache/test/test-plugin/1.0.0',
                            version: '1.0.0',
                            installedAt: '2026-01-01T00:00:00.000Z',
                        },
                    ],
                },
            });

            const manifestContent = JSON.stringify({
                name: 'test-plugin',
                description: 'Test plugin',
                version: '1.0.0',
            });

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/home/user/.dexto/plugins/installed_plugins.json') return true;
                if (p === '/home/user/.dexto/plugins/cache/test/test-plugin/1.0.0') return true;
                if (
                    p ===
                    '/home/user/.dexto/plugins/cache/test/test-plugin/1.0.0/.claude-plugin/plugin.json'
                )
                    return true;
                return false;
            });

            vi.mocked(fs.readFileSync).mockImplementation((p) => {
                if (typeof p === 'string' && p.endsWith('installed_plugins.json')) {
                    return installedPluginsContent;
                }
                if (typeof p === 'string' && p.endsWith('plugin.json')) {
                    return manifestContent;
                }
                return '';
            });

            const result = listInstalledPlugins('/test/project');

            // Should be included because it's user-scoped
            expect(result).toHaveLength(1);
            expect(result[0]!.name).toBe('test-plugin');
        });

        it('should NOT re-add filtered plugins via cache scanning', () => {
            // This is the bug fix test: plugins filtered by scope from installed_plugins.json
            // should NOT reappear when scanning the cache directory

            const installedPluginsContent = JSON.stringify({
                version: 2,
                plugins: {
                    'filtered-plugin@test-marketplace': [
                        {
                            scope: 'local',
                            projectPath: '/different/project',
                            installPath:
                                '/home/user/.dexto/plugins/cache/test/filtered-plugin/1.0.0',
                            version: '1.0.0',
                            installedAt: '2026-01-01T00:00:00.000Z',
                        },
                    ],
                },
            });

            const manifestContent = JSON.stringify({
                name: 'filtered-plugin',
                description: 'Plugin that should be filtered',
                version: '1.0.0',
            });

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/home/user/.dexto/plugins/installed_plugins.json') return true;
                if (p === '/home/user/.claude/plugins/cache') return true;
                if (p === '/home/user/.dexto/plugins/cache/test/filtered-plugin/1.0.0') return true;
                if (
                    p ===
                    '/home/user/.dexto/plugins/cache/test/filtered-plugin/1.0.0/.claude-plugin/plugin.json'
                )
                    return true;
                return false;
            });

            vi.mocked(fs.readFileSync).mockImplementation((p) => {
                if (typeof p === 'string' && p.endsWith('installed_plugins.json')) {
                    return installedPluginsContent;
                }
                if (typeof p === 'string' && p.endsWith('plugin.json')) {
                    return manifestContent;
                }
                return '';
            });

            // Mock cache directory structure scanning
            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                const dirStr = typeof dir === 'string' ? dir : dir.toString();
                if (dirStr === '/home/user/.claude/plugins/cache') {
                    return [createDirent('test', true)] as any;
                }
                if (dirStr === '/home/user/.dexto/plugins/cache/test') {
                    return [createDirent('filtered-plugin', true)] as any;
                }
                if (dirStr === '/home/user/.dexto/plugins/cache/test/filtered-plugin') {
                    return [createDirent('1.0.0', true)] as any;
                }
                return [];
            });

            const result = listInstalledPlugins('/test/project');

            // Should be 0 because:
            // 1. Filtered out by scope check in readClaudeCodeInstalledPlugins
            // 2. Should NOT be re-added by scanClaudeCodeCache (this is the bug fix)
            expect(result).toHaveLength(0);
        });
    });

    describe('cache scanning', () => {
        it('does not list plugins in cache that are not tracked in installed_plugins.json', () => {
            // Plugins must be tracked in installed_plugins.json or placed directly in
            // ~/.dexto/plugins/ or <cwd>/.dexto/plugins/ (not in cache subdirectory)
            // The cache directory is only for versioned copies managed by the install system

            const installedPluginsContent = JSON.stringify({
                version: 2,
                plugins: {},
            });

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/home/user/.dexto/plugins/installed_plugins.json') return true;
                return false;
            });

            vi.mocked(fs.readFileSync).mockImplementation((p) => {
                if (typeof p === 'string' && p.endsWith('installed_plugins.json')) {
                    return installedPluginsContent;
                }
                return '';
            });

            vi.mocked(fs.readdirSync).mockReturnValue([]);

            const result = listInstalledPlugins('/test/project');

            // No plugins should be found because nothing is tracked in installed_plugins.json
            // and no plugins are directly in the plugins directories
            expect(result).toHaveLength(0);
        });
    });
});
