/**
 * Marketplace Operations Unit Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as childProcess from 'child_process';

// Mock fs module
vi.mock('fs', async () => {
    const actual = await vi.importActual<typeof import('fs')>('fs');
    return {
        ...actual,
        existsSync: vi.fn(),
        readFileSync: vi.fn(),
        writeFileSync: vi.fn(),
        mkdirSync: vi.fn(),
        readdirSync: vi.fn(),
        rmSync: vi.fn(),
        statSync: vi.fn(),
    };
});

// Mock child_process
vi.mock('child_process', async () => {
    const actual = await vi.importActual<typeof import('child_process')>('child_process');
    return {
        ...actual,
        execSync: vi.fn(),
    };
});

// Mock registry functions
vi.mock('../registry.js', () => ({
    getMarketplacesDir: vi.fn(() => '/home/testuser/.dexto/plugins/marketplaces'),
    loadKnownMarketplaces: vi.fn(() => ({ version: 1, marketplaces: {} })),
    addMarketplaceEntry: vi.fn(),
    removeMarketplaceEntry: vi.fn(() => true),
    getMarketplaceEntry: vi.fn(),
    getAllMarketplaces: vi.fn(() => []),
    updateMarketplaceTimestamp: vi.fn(),
}));

// Mock validate-plugin
vi.mock('../../validate-plugin.js', () => ({
    tryLoadManifest: vi.fn(),
}));

import {
    parseMarketplaceSource,
    deriveMarketplaceName,
    addMarketplace,
    removeMarketplace,
    updateMarketplace,
    listMarketplaces,
    scanMarketplacePlugins,
    findPluginInMarketplaces,
} from '../operations.js';
import {
    addMarketplaceEntry,
    removeMarketplaceEntry,
    getMarketplaceEntry,
    getAllMarketplaces,
} from '../registry.js';
import { tryLoadManifest } from '../../validate-plugin.js';
import type { MarketplaceEntry } from '../types.js';
import type { PluginManifest } from '../../types.js';

describe('Marketplace Operations', () => {
    beforeEach(() => {
        vi.mocked(fs.existsSync).mockReset();
        vi.mocked(fs.readFileSync).mockReset();
        vi.mocked(fs.writeFileSync).mockReset();
        vi.mocked(fs.readdirSync).mockReset();
        vi.mocked(fs.rmSync).mockReset();
        vi.mocked(childProcess.execSync).mockReset();
        vi.mocked(getMarketplaceEntry).mockReset();
        vi.mocked(getAllMarketplaces).mockReset();
        vi.mocked(addMarketplaceEntry).mockReset();
        vi.mocked(removeMarketplaceEntry).mockReset();
        vi.mocked(tryLoadManifest).mockReset();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('parseMarketplaceSource', () => {
        it('parses local absolute path', () => {
            const result = parseMarketplaceSource('/path/to/marketplace');
            expect(result).toEqual({ type: 'local', value: '/path/to/marketplace' });
        });

        it('parses local relative path starting with ./', () => {
            const result = parseMarketplaceSource('./local-marketplace');
            expect(result).toEqual({ type: 'local', value: './local-marketplace' });
        });

        it('parses local relative path starting with ../', () => {
            const result = parseMarketplaceSource('../parent-marketplace');
            expect(result).toEqual({ type: 'local', value: '../parent-marketplace' });
        });

        it('parses home-relative path', () => {
            const result = parseMarketplaceSource('~/my-marketplace');
            expect(result).toEqual({ type: 'local', value: '~/my-marketplace' });
        });

        it('parses GitHub shorthand (owner/repo)', () => {
            const result = parseMarketplaceSource('anthropics/claude-plugins');
            expect(result).toEqual({ type: 'github', value: 'anthropics/claude-plugins' });
        });

        it('parses HTTPS git URL', () => {
            const result = parseMarketplaceSource('https://github.com/owner/repo.git');
            expect(result).toEqual({
                type: 'git',
                value: 'https://github.com/owner/repo.git',
            });
        });

        it('parses SSH git URL', () => {
            const result = parseMarketplaceSource('git@github.com:owner/repo.git');
            expect(result).toEqual({ type: 'git', value: 'git@github.com:owner/repo.git' });
        });

        it('parses URL ending with .git', () => {
            const result = parseMarketplaceSource('example.com/repo.git');
            expect(result).toEqual({ type: 'git', value: 'example.com/repo.git' });
        });

        it('defaults to git for unknown format', () => {
            const result = parseMarketplaceSource('some-unknown-format');
            expect(result).toEqual({ type: 'git', value: 'some-unknown-format' });
        });
    });

    describe('deriveMarketplaceName', () => {
        it('extracts repo name from GitHub shorthand', () => {
            const result = deriveMarketplaceName({ type: 'github', value: 'owner/repo-name' });
            expect(result).toBe('repo-name');
        });

        it('extracts repo name from git URL', () => {
            const result = deriveMarketplaceName({
                type: 'git',
                value: 'https://github.com/owner/my-plugins.git',
            });
            expect(result).toBe('my-plugins');
        });

        it('uses directory name for local path', () => {
            const result = deriveMarketplaceName({
                type: 'local',
                value: '/path/to/my-local-marketplace',
            });
            expect(result).toBe('my-local-marketplace');
        });

        it('handles home-relative paths', () => {
            const originalHome = process.env.HOME;
            process.env.HOME = '/home/testuser';

            const result = deriveMarketplaceName({
                type: 'local',
                value: '~/plugins/marketplace',
            });
            expect(result).toBe('marketplace');

            process.env.HOME = originalHome;
        });
    });

    describe('addMarketplace', () => {
        it('throws error when marketplace already exists', async () => {
            vi.mocked(getMarketplaceEntry).mockReturnValue({
                name: 'existing-market',
                source: { type: 'github', value: 'owner/repo' },
                installLocation: '/path/to/existing',
            });

            await expect(addMarketplace('owner/existing-market')).rejects.toThrow(
                /already exists/i
            );
        });

        it('throws error when local path does not exist', async () => {
            vi.mocked(getMarketplaceEntry).mockReturnValue(null);
            vi.mocked(fs.existsSync).mockReturnValue(false);

            await expect(addMarketplace('/nonexistent/path')).rejects.toThrow();
        });

        it('clones GitHub repository', async () => {
            vi.mocked(getMarketplaceEntry).mockReturnValue(null);
            vi.mocked(fs.existsSync).mockImplementation((p) => {
                // Marketplace path exists after clone
                return typeof p === 'string' && p.includes('test-repo');
            });
            vi.mocked(childProcess.execSync).mockReturnValue('');
            vi.mocked(fs.readdirSync).mockReturnValue([]);

            const result = await addMarketplace('owner/test-repo');

            expect(childProcess.execSync).toHaveBeenCalledWith(
                expect.stringContaining('git clone'),
                expect.any(Object)
            );
            expect(result.success).toBe(true);
            expect(result.name).toBe('test-repo');
        });

        it('respects custom name option', async () => {
            vi.mocked(getMarketplaceEntry).mockReturnValue(null);
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(childProcess.execSync).mockReturnValue('');
            vi.mocked(fs.readdirSync).mockReturnValue([]);

            const result = await addMarketplace('owner/repo', { name: 'custom-name' });

            expect(result.name).toBe('custom-name');
        });

        it('registers local marketplace without cloning', async () => {
            vi.mocked(getMarketplaceEntry).mockReturnValue(null);
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readdirSync).mockReturnValue([]);

            const result = await addMarketplace('/local/path/marketplace');

            expect(childProcess.execSync).not.toHaveBeenCalledWith(
                expect.stringContaining('git clone'),
                expect.any(Object)
            );
            expect(result.success).toBe(true);
            expect(addMarketplaceEntry).toHaveBeenCalled();
        });

        it('warns when no plugins found', async () => {
            vi.mocked(getMarketplaceEntry).mockReturnValue(null);
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readdirSync).mockReturnValue([]);

            const result = await addMarketplace('/local/marketplace');

            expect(result.warnings).toContain('No plugins found in marketplace');
        });
    });

    describe('removeMarketplace', () => {
        it('throws error when marketplace not found', async () => {
            vi.mocked(getMarketplaceEntry).mockReturnValue(null);

            await expect(removeMarketplace('nonexistent')).rejects.toThrow(/not found/i);
        });

        it('deletes cloned directory for non-local marketplaces', async () => {
            const mockEntry: MarketplaceEntry = {
                name: 'test-market',
                source: { type: 'github', value: 'owner/repo' },
                installLocation: '/home/testuser/.dexto/plugins/marketplaces/test-market',
            };
            vi.mocked(getMarketplaceEntry).mockReturnValue(mockEntry);
            vi.mocked(fs.existsSync).mockReturnValue(true);

            const result = await removeMarketplace('test-market');

            expect(fs.rmSync).toHaveBeenCalledWith(mockEntry.installLocation, {
                recursive: true,
                force: true,
            });
            expect(result.success).toBe(true);
        });

        it('does not delete directory for local marketplaces', async () => {
            const mockEntry: MarketplaceEntry = {
                name: 'local-market',
                source: { type: 'local', value: '/local/path' },
                installLocation: '/local/path',
            };
            vi.mocked(getMarketplaceEntry).mockReturnValue(mockEntry);

            const result = await removeMarketplace('local-market');

            expect(fs.rmSync).not.toHaveBeenCalled();
            expect(result.success).toBe(true);
        });
    });

    describe('updateMarketplace', () => {
        it('throws error when marketplace not found', async () => {
            vi.mocked(getMarketplaceEntry).mockReturnValue(null);

            await expect(updateMarketplace('nonexistent')).rejects.toThrow(/not found/i);
        });

        it('returns warning for local marketplaces', async () => {
            const mockEntry: MarketplaceEntry = {
                name: 'local-market',
                source: { type: 'local', value: '/local/path' },
                installLocation: '/local/path',
            };
            vi.mocked(getMarketplaceEntry).mockReturnValue(mockEntry);

            const results = await updateMarketplace('local-market');

            expect(results[0]!.hasChanges).toBe(false);
            expect(results[0]!.warnings).toContain(
                'Local marketplaces do not support automatic updates'
            );
        });

        it('runs git pull for git-based marketplaces', async () => {
            const mockEntry: MarketplaceEntry = {
                name: 'git-market',
                source: { type: 'github', value: 'owner/repo' },
                installLocation: '/path/to/marketplace',
            };
            vi.mocked(getMarketplaceEntry).mockReturnValue(mockEntry);
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(childProcess.execSync).mockReturnValue('abc123\n');

            const results = await updateMarketplace('git-market');

            expect(childProcess.execSync).toHaveBeenCalledWith('git pull --ff-only', {
                cwd: mockEntry.installLocation,
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            expect(results[0]!.success).toBe(true);
        });

        it('updates all marketplaces when name not specified', async () => {
            const marketplaces: MarketplaceEntry[] = [
                {
                    name: 'market1',
                    source: { type: 'github', value: 'owner/repo1' },
                    installLocation: '/path1',
                },
                {
                    name: 'market2',
                    source: { type: 'github', value: 'owner/repo2' },
                    installLocation: '/path2',
                },
            ];
            vi.mocked(getAllMarketplaces).mockReturnValue(marketplaces);
            vi.mocked(getMarketplaceEntry).mockImplementation(
                (name) => marketplaces.find((m) => m.name === name) || null
            );
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(childProcess.execSync).mockReturnValue('abc123\n');

            const results = await updateMarketplace();

            expect(results).toHaveLength(2);
        });
    });

    describe('listMarketplaces', () => {
        it('returns all registered marketplaces', () => {
            const marketplaces: MarketplaceEntry[] = [
                {
                    name: 'dexto-market',
                    source: { type: 'github', value: 'dexto/plugins' },
                    installLocation: '/dexto/path',
                },
                {
                    name: 'custom-market',
                    source: { type: 'github', value: 'user/plugins' },
                    installLocation: '/custom/path',
                },
            ];
            vi.mocked(getAllMarketplaces).mockReturnValue(marketplaces);

            const result = listMarketplaces();

            expect(result).toHaveLength(2);
            expect(getAllMarketplaces).toHaveBeenCalled();
        });
    });

    describe('scanMarketplacePlugins', () => {
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

        it('loads plugins from marketplace.json manifest', () => {
            const manifest = {
                name: 'Test Marketplace',
                plugins: [
                    { name: 'plugin1', description: 'First plugin', source: 'plugins/plugin1' },
                    { name: 'plugin2', description: 'Second plugin', source: 'plugins/plugin2' },
                ],
            };

            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(manifest));

            const result = scanMarketplacePlugins('/marketplace', 'test-market');

            expect(result).toHaveLength(2);
            expect(result[0]!.name).toBe('plugin1');
            expect(result[1]!.name).toBe('plugin2');
        });

        it('scans plugins/ directory when no manifest', () => {
            vi.mocked(fs.existsSync).mockImplementation((p) => {
                const pathStr = typeof p === 'string' ? p : p.toString();
                if (pathStr.endsWith('marketplace.json')) return false;
                if (
                    pathStr === '/marketplace/plugins' ||
                    pathStr === '/marketplace/plugins/my-plugin'
                )
                    return true;
                // external_plugins doesn't exist
                if (pathStr.includes('external_plugins')) return false;
                return false;
            });
            vi.mocked(fs.readFileSync).mockImplementation(() => {
                throw new Error('No manifest');
            });
            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                const dirStr = typeof dir === 'string' ? dir : dir.toString();
                if (dirStr === '/marketplace/plugins') {
                    return [createDirent('my-plugin', true)] as any;
                }
                if (dirStr === '/marketplace') {
                    // Root scan should return plugins dir (which we skip) and maybe .git
                    return [createDirent('plugins', true), createDirent('.git', true)] as any;
                }
                return [];
            });
            vi.mocked(tryLoadManifest).mockImplementation((p: string): PluginManifest | null => {
                if (p === '/marketplace/plugins/my-plugin') {
                    return { name: 'my-plugin', description: 'A plugin' };
                }
                return null;
            });

            const result = scanMarketplacePlugins('/marketplace', 'test-market');

            expect(result).toHaveLength(1);
            expect(result[0]!.name).toBe('my-plugin');
        });
    });

    describe('findPluginInMarketplaces', () => {
        it('finds plugin by name (case-insensitive)', () => {
            const mockEntry: MarketplaceEntry = {
                name: 'test-market',
                source: { type: 'github', value: 'owner/repo' },
                installLocation: '/path/to/marketplace',
            };
            vi.mocked(getAllMarketplaces).mockReturnValue([mockEntry]);
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(
                JSON.stringify({
                    name: 'Test Marketplace',
                    plugins: [{ name: 'MyPlugin', source: 'plugins/myplugin' }],
                })
            );

            const result = findPluginInMarketplaces('myplugin');

            expect(result).not.toBeNull();
            expect(result!.name).toBe('MyPlugin');
        });

        it('searches specific marketplace when specified', () => {
            const mockEntry: MarketplaceEntry = {
                name: 'specific-market',
                source: { type: 'github', value: 'owner/repo' },
                installLocation: '/path/to/specific',
            };
            vi.mocked(getMarketplaceEntry).mockReturnValue(mockEntry);
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(
                JSON.stringify({
                    name: 'Specific Marketplace',
                    plugins: [{ name: 'TargetPlugin', source: 'plugins/target' }],
                })
            );

            const result = findPluginInMarketplaces('targetplugin', 'specific-market');

            expect(result).not.toBeNull();
            expect(result!.marketplace).toBe('specific-market');
        });

        it('returns null when plugin not found', () => {
            vi.mocked(getAllMarketplaces).mockReturnValue([]);

            const result = findPluginInMarketplaces('nonexistent');

            expect(result).toBeNull();
        });
    });
});
