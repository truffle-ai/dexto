/**
 * Install from Marketplace Unit Tests
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
        mkdirSync: vi.fn(),
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

// Mock path utilities
vi.mock('../../../utils/path.js', () => ({
    copyDirectory: vi.fn(),
}));

// Mock registry
vi.mock('../registry.js', () => ({
    getMarketplaceCacheDir: vi.fn(() => '/home/testuser/.dexto/plugins/cache'),
    getMarketplaceEntry: vi.fn(),
}));

// Mock operations
vi.mock('../operations.js', () => ({
    findPluginInMarketplaces: vi.fn(),
    scanMarketplacePlugins: vi.fn(),
}));

// Mock install-plugin
vi.mock('../../install-plugin.js', () => ({
    installPluginFromPath: vi.fn(),
}));

import {
    parsePluginSpec,
    installPluginFromMarketplace,
    searchMarketplacePlugins,
} from '../install-from-marketplace.js';
import { getMarketplaceEntry } from '../registry.js';
import { findPluginInMarketplaces, scanMarketplacePlugins } from '../operations.js';
import { installPluginFromPath } from '../../install-plugin.js';
import { copyDirectory } from '../../../utils/path.js';
import type { MarketplacePlugin, MarketplaceEntry } from '../types.js';

describe('Install from Marketplace', () => {
    beforeEach(() => {
        vi.mocked(fs.existsSync).mockReset();
        vi.mocked(fs.mkdirSync).mockReset();
        vi.mocked(childProcess.execSync).mockReset();
        vi.mocked(getMarketplaceEntry).mockReset();
        vi.mocked(findPluginInMarketplaces).mockReset();
        vi.mocked(scanMarketplacePlugins).mockReset();
        vi.mocked(installPluginFromPath).mockReset();
        vi.mocked(copyDirectory).mockReset();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('parsePluginSpec', () => {
        it('parses plugin name without marketplace', () => {
            const result = parsePluginSpec('my-plugin');
            expect(result).toEqual({ pluginName: 'my-plugin' });
        });

        it('parses plugin name with marketplace', () => {
            const result = parsePluginSpec('my-plugin@my-marketplace');
            expect(result).toEqual({
                pluginName: 'my-plugin',
                marketplace: 'my-marketplace',
            });
        });

        it('handles plugin names starting with @', () => {
            const result = parsePluginSpec('@scoped/plugin');
            expect(result).toEqual({ pluginName: '@scoped/plugin' });
        });

        it('handles scoped plugin with marketplace', () => {
            const result = parsePluginSpec('@scoped/plugin@marketplace');
            expect(result).toEqual({
                pluginName: '@scoped/plugin',
                marketplace: 'marketplace',
            });
        });

        it('uses last @ for marketplace separator', () => {
            const result = parsePluginSpec('plugin@with@multiple@at@market');
            expect(result).toEqual({
                pluginName: 'plugin@with@multiple@at',
                marketplace: 'market',
            });
        });
    });

    describe('installPluginFromMarketplace', () => {
        const mockMarketplaceEntry: MarketplaceEntry = {
            name: 'test-market',
            source: { type: 'github', value: 'owner/repo' },
            installLocation: '/path/to/marketplace',
        };

        const mockPlugin: MarketplacePlugin = {
            name: 'test-plugin',
            description: 'A test plugin',
            sourcePath: '/path/to/marketplace/plugins/test-plugin',
            marketplace: 'test-market',
        };

        it('throws error when specified marketplace not found', async () => {
            vi.mocked(getMarketplaceEntry).mockReturnValue(null);

            await expect(installPluginFromMarketplace('plugin@nonexistent-market')).rejects.toThrow(
                /marketplace.*not found/i
            );
        });

        it('throws error when plugin not found in specified marketplace', async () => {
            vi.mocked(getMarketplaceEntry).mockReturnValue(mockMarketplaceEntry);
            vi.mocked(scanMarketplacePlugins).mockReturnValue([]);

            await expect(
                installPluginFromMarketplace('nonexistent-plugin@test-market')
            ).rejects.toThrow(/plugin.*not found/i);
        });

        it('throws error when plugin not found in any marketplace', async () => {
            vi.mocked(findPluginInMarketplaces).mockReturnValue(null);

            await expect(installPluginFromMarketplace('nonexistent-plugin')).rejects.toThrow(
                /plugin.*not found/i
            );
        });

        it('installs plugin from specified marketplace', async () => {
            vi.mocked(getMarketplaceEntry).mockReturnValue(mockMarketplaceEntry);
            vi.mocked(scanMarketplacePlugins).mockReturnValue([mockPlugin]);
            vi.mocked(fs.existsSync).mockImplementation((p) => {
                // Cache doesn't exist yet
                const pathStr = typeof p === 'string' ? p : p.toString();
                return !pathStr.includes('cache');
            });
            vi.mocked(childProcess.execSync).mockReturnValue('abc123def456\n');
            vi.mocked(installPluginFromPath).mockResolvedValue({
                success: true,
                pluginName: 'test-plugin',
                installPath: '/installed/path',
                warnings: [],
            });

            const result = await installPluginFromMarketplace('test-plugin@test-market');

            expect(result.success).toBe(true);
            expect(result.pluginName).toBe('test-plugin');
            expect(result.marketplace).toBe('test-market');
            expect(copyDirectory).toHaveBeenCalled();
        });

        it('searches all marketplaces when no marketplace specified', async () => {
            vi.mocked(findPluginInMarketplaces).mockReturnValue(mockPlugin);
            vi.mocked(getMarketplaceEntry).mockReturnValue(mockMarketplaceEntry);
            vi.mocked(fs.existsSync).mockReturnValue(false);
            vi.mocked(childProcess.execSync).mockReturnValue('abc123\n');
            vi.mocked(installPluginFromPath).mockResolvedValue({
                success: true,
                pluginName: 'test-plugin',
                installPath: '/installed/path',
                warnings: [],
            });

            const result = await installPluginFromMarketplace('test-plugin');

            expect(findPluginInMarketplaces).toHaveBeenCalledWith('test-plugin');
            expect(result.warnings).toContain('Found plugin in marketplace: test-market');
        });

        it('uses cached copy if already exists', async () => {
            vi.mocked(findPluginInMarketplaces).mockReturnValue(mockPlugin);
            vi.mocked(getMarketplaceEntry).mockReturnValue(mockMarketplaceEntry);
            vi.mocked(fs.existsSync).mockReturnValue(true); // Cache exists
            vi.mocked(childProcess.execSync).mockReturnValue('abc123\n');
            vi.mocked(installPluginFromPath).mockResolvedValue({
                success: true,
                pluginName: 'test-plugin',
                installPath: '/installed/path',
                warnings: [],
            });

            await installPluginFromMarketplace('test-plugin');

            // copyDirectory should not be called since cache exists
            expect(copyDirectory).not.toHaveBeenCalled();
        });

        it('passes scope option to installPluginFromPath', async () => {
            vi.mocked(findPluginInMarketplaces).mockReturnValue(mockPlugin);
            vi.mocked(getMarketplaceEntry).mockReturnValue(mockMarketplaceEntry);
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(childProcess.execSync).mockReturnValue('abc123\n');
            vi.mocked(installPluginFromPath).mockResolvedValue({
                success: true,
                pluginName: 'test-plugin',
                installPath: '/installed/path',
                warnings: [],
            });

            await installPluginFromMarketplace('test-plugin', { scope: 'project' });

            expect(installPluginFromPath).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ scope: 'project' })
            );
        });

        it('passes force option to installPluginFromPath', async () => {
            vi.mocked(findPluginInMarketplaces).mockReturnValue(mockPlugin);
            vi.mocked(getMarketplaceEntry).mockReturnValue(mockMarketplaceEntry);
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(childProcess.execSync).mockReturnValue('abc123\n');
            vi.mocked(installPluginFromPath).mockResolvedValue({
                success: true,
                pluginName: 'test-plugin',
                installPath: '/installed/path',
                warnings: [],
            });

            await installPluginFromMarketplace('test-plugin', { force: true });

            expect(installPluginFromPath).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ force: true })
            );
        });

        it('includes git commit SHA in result', async () => {
            vi.mocked(findPluginInMarketplaces).mockReturnValue(mockPlugin);
            vi.mocked(getMarketplaceEntry).mockReturnValue(mockMarketplaceEntry);
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(childProcess.execSync).mockReturnValue('abc123def456789\n');
            vi.mocked(installPluginFromPath).mockResolvedValue({
                success: true,
                pluginName: 'test-plugin',
                installPath: '/installed/path',
                warnings: [],
            });

            const result = await installPluginFromMarketplace('test-plugin');

            expect(result.gitCommitSha).toBe('abc123def456789');
        });
    });

    describe('searchMarketplacePlugins', () => {
        it('filters plugins by name', () => {
            const mockEntry: MarketplaceEntry = {
                name: 'test-market',
                source: { type: 'github', value: 'owner/repo' },
                installLocation: '/path/to/marketplace',
            };
            const plugins: MarketplacePlugin[] = [
                { name: 'commit-helper', sourcePath: '/p1', marketplace: 'test-market' },
                { name: 'test-runner', sourcePath: '/p2', marketplace: 'test-market' },
                { name: 'linter', sourcePath: '/p3', marketplace: 'test-market' },
            ];

            vi.mocked(getMarketplaceEntry).mockReturnValue(mockEntry);
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(scanMarketplacePlugins).mockReturnValue(plugins);

            const result = searchMarketplacePlugins('commit', 'test-market');

            expect(result).toHaveLength(1);
            expect(result[0]!.name).toBe('commit-helper');
        });

        it('filters plugins by description', () => {
            const mockEntry: MarketplaceEntry = {
                name: 'test-market',
                source: { type: 'github', value: 'owner/repo' },
                installLocation: '/path/to/marketplace',
            };
            const plugins: MarketplacePlugin[] = [
                {
                    name: 'plugin-a',
                    description: 'Helps with git commits',
                    sourcePath: '/p1',
                    marketplace: 'test-market',
                },
                {
                    name: 'plugin-b',
                    description: 'Runs tests',
                    sourcePath: '/p2',
                    marketplace: 'test-market',
                },
            ];

            vi.mocked(getMarketplaceEntry).mockReturnValue(mockEntry);
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(scanMarketplacePlugins).mockReturnValue(plugins);

            const result = searchMarketplacePlugins('commit', 'test-market');

            expect(result).toHaveLength(1);
            expect(result[0]!.name).toBe('plugin-a');
        });

        it('returns empty array when marketplace not found', () => {
            vi.mocked(getMarketplaceEntry).mockReturnValue(null);

            const result = searchMarketplacePlugins('query', 'nonexistent');

            expect(result).toEqual([]);
        });

        it('returns empty array when marketplace location does not exist', () => {
            vi.mocked(getMarketplaceEntry).mockReturnValue({
                name: 'test-market',
                source: { type: 'github', value: 'owner/repo' },
                installLocation: '/nonexistent/path',
            });
            vi.mocked(fs.existsSync).mockReturnValue(false);

            const result = searchMarketplacePlugins('query', 'test-market');

            expect(result).toEqual([]);
        });

        it('performs case-insensitive search', () => {
            const mockEntry: MarketplaceEntry = {
                name: 'test-market',
                source: { type: 'github', value: 'owner/repo' },
                installLocation: '/path/to/marketplace',
            };
            const plugins: MarketplacePlugin[] = [
                { name: 'MyPlugin', sourcePath: '/p1', marketplace: 'test-market' },
                { name: 'other', sourcePath: '/p2', marketplace: 'test-market' },
            ];

            vi.mocked(getMarketplaceEntry).mockReturnValue(mockEntry);
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(scanMarketplacePlugins).mockReturnValue(plugins);

            const result = searchMarketplacePlugins('myplugin', 'test-market');

            expect(result).toHaveLength(1);
            expect(result[0]!.name).toBe('MyPlugin');
        });
    });
});
