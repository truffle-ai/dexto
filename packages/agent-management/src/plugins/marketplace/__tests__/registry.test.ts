/**
 * Marketplace Registry Unit Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';

// Mock fs module
vi.mock('fs', async () => {
    const actual = await vi.importActual<typeof import('fs')>('fs');
    return {
        ...actual,
        existsSync: vi.fn(),
        readFileSync: vi.fn(),
        writeFileSync: vi.fn(),
        mkdirSync: vi.fn(),
    };
});

// Mock os module
vi.mock('os', async () => {
    const actual = await vi.importActual<typeof import('os')>('os');
    return {
        ...actual,
        homedir: vi.fn(() => '/home/testuser'),
    };
});

import {
    DEFAULT_MARKETPLACES,
    getMarketplacesRegistryPath,
    getMarketplacesDir,
    getMarketplaceCacheDir,
    loadKnownMarketplaces,
    saveKnownMarketplaces,
    getMarketplaceEntry,
    marketplaceExists,
    getAllMarketplaces,
    getClaudeCodeMarketplacesPath,
    loadClaudeCodeMarketplaces,
    getAllMarketplacesWithClaudeCode,
    addMarketplaceEntry,
    removeMarketplaceEntry,
    updateMarketplaceTimestamp,
    getUninstalledDefaults,
    isDefaultMarketplace,
} from '../registry.js';
import type { KnownMarketplacesFile, MarketplaceEntry } from '../types.js';

describe('Marketplace Registry', () => {
    const mockHomedir = '/home/testuser';

    beforeEach(() => {
        vi.mocked(fs.existsSync).mockReset();
        vi.mocked(fs.readFileSync).mockReset();
        vi.mocked(fs.writeFileSync).mockReset();
        vi.mocked(fs.mkdirSync).mockReset();
        vi.mocked(os.homedir).mockReturnValue(mockHomedir);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('path functions', () => {
        it('getMarketplacesRegistryPath returns correct path', () => {
            const result = getMarketplacesRegistryPath();
            expect(result).toBe(`${mockHomedir}/.dexto/plugins/known_marketplaces.json`);
        });

        it('getMarketplacesDir returns correct path', () => {
            const result = getMarketplacesDir();
            expect(result).toBe(`${mockHomedir}/.dexto/plugins/marketplaces`);
        });

        it('getMarketplaceCacheDir returns correct path', () => {
            const result = getMarketplaceCacheDir();
            expect(result).toBe(`${mockHomedir}/.dexto/plugins/cache`);
        });
    });

    describe('loadKnownMarketplaces', () => {
        it('returns empty structure when file does not exist', () => {
            vi.mocked(fs.existsSync).mockReturnValue(false);

            const result = loadKnownMarketplaces();

            expect(result).toEqual({ version: 1, marketplaces: {} });
        });

        it('loads and parses valid file', () => {
            const mockData: KnownMarketplacesFile = {
                version: 1,
                marketplaces: {
                    'test-marketplace': {
                        name: 'test-marketplace',
                        source: { type: 'github', value: 'owner/repo' },
                        installLocation: '/path/to/marketplace',
                        lastUpdated: '2026-01-01T00:00:00.000Z',
                    },
                },
            };

            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockData));

            const result = loadKnownMarketplaces();

            expect(result.version).toBe(1);
            expect(result.marketplaces['test-marketplace']).toBeDefined();
            expect(result.marketplaces['test-marketplace']!.name).toBe('test-marketplace');
        });

        it('returns empty structure on invalid JSON', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue('invalid json');

            const result = loadKnownMarketplaces();

            expect(result).toEqual({ version: 1, marketplaces: {} });
        });

        it('returns empty structure on schema validation failure', () => {
            const invalidData = {
                version: 'not-a-number', // Invalid: should be number
                marketplaces: {},
            };

            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(invalidData));

            const result = loadKnownMarketplaces();

            expect(result).toEqual({ version: 1, marketplaces: {} });
        });
    });

    describe('saveKnownMarketplaces', () => {
        it('creates directory if it does not exist', () => {
            vi.mocked(fs.existsSync).mockReturnValue(false);

            const data: KnownMarketplacesFile = { version: 1, marketplaces: {} };
            saveKnownMarketplaces(data);

            expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('.dexto/plugins'), {
                recursive: true,
            });
        });

        it('writes data as formatted JSON', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);

            const data: KnownMarketplacesFile = {
                version: 1,
                marketplaces: {
                    test: {
                        name: 'test',
                        source: { type: 'github', value: 'owner/repo' },
                        installLocation: '/path',
                    },
                },
            };
            saveKnownMarketplaces(data);

            expect(fs.writeFileSync).toHaveBeenCalledWith(
                expect.any(String),
                JSON.stringify(data, null, 2),
                'utf-8'
            );
        });

        it('throws MarketplaceError on write failure', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.writeFileSync).mockImplementation(() => {
                throw new Error('Write failed');
            });

            const data: KnownMarketplacesFile = { version: 1, marketplaces: {} };

            expect(() => saveKnownMarketplaces(data)).toThrow('Write failed');
        });
    });

    describe('getMarketplaceEntry', () => {
        it('returns entry when it exists', () => {
            const mockEntry: MarketplaceEntry = {
                name: 'test-marketplace',
                source: { type: 'github', value: 'owner/repo' },
                installLocation: '/path/to/marketplace',
            };

            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(
                JSON.stringify({
                    version: 1,
                    marketplaces: { 'test-marketplace': mockEntry },
                })
            );

            const result = getMarketplaceEntry('test-marketplace');

            expect(result).toEqual(mockEntry);
        });

        it('returns null when entry does not exist', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(
                JSON.stringify({ version: 1, marketplaces: {} })
            );

            const result = getMarketplaceEntry('nonexistent');

            expect(result).toBeNull();
        });
    });

    describe('marketplaceExists', () => {
        it('returns true when marketplace exists', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(
                JSON.stringify({
                    version: 1,
                    marketplaces: {
                        'test-marketplace': {
                            name: 'test-marketplace',
                            source: { type: 'github', value: 'owner/repo' },
                            installLocation: '/path',
                        },
                    },
                })
            );

            expect(marketplaceExists('test-marketplace')).toBe(true);
        });

        it('returns false when marketplace does not exist', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(
                JSON.stringify({ version: 1, marketplaces: {} })
            );

            expect(marketplaceExists('nonexistent')).toBe(false);
        });
    });

    describe('getAllMarketplaces', () => {
        it('returns all marketplace entries as array', () => {
            const marketplaces = {
                market1: {
                    name: 'market1',
                    source: { type: 'github' as const, value: 'owner/repo1' },
                    installLocation: '/path1',
                },
                market2: {
                    name: 'market2',
                    source: { type: 'git' as const, value: 'https://git.example.com/repo' },
                    installLocation: '/path2',
                },
            };

            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(
                JSON.stringify({ version: 1, marketplaces })
            );

            const result = getAllMarketplaces();

            expect(result).toHaveLength(2);
            expect(result.map((m) => m.name)).toContain('market1');
            expect(result.map((m) => m.name)).toContain('market2');
        });
    });

    describe('Claude Code integration', () => {
        describe('getClaudeCodeMarketplacesPath', () => {
            it('returns path when file exists', () => {
                vi.mocked(fs.existsSync).mockImplementation((p) => {
                    return typeof p === 'string' && p.includes('.claude');
                });

                const result = getClaudeCodeMarketplacesPath();

                expect(result).toBe(`${mockHomedir}/.claude/plugins/known_marketplaces.json`);
            });

            it('returns null when file does not exist', () => {
                vi.mocked(fs.existsSync).mockReturnValue(false);

                const result = getClaudeCodeMarketplacesPath();

                expect(result).toBeNull();
            });
        });

        describe('loadClaudeCodeMarketplaces', () => {
            it('returns empty array when file does not exist', () => {
                vi.mocked(fs.existsSync).mockReturnValue(false);

                const result = loadClaudeCodeMarketplaces();

                expect(result).toEqual([]);
            });

            it('loads marketplaces from Claude Code registry', () => {
                const claudeMarketplaces = {
                    version: 1,
                    marketplaces: {
                        'claude-marketplace': {
                            name: 'claude-marketplace',
                            source: { type: 'github', value: 'anthropics/plugins' },
                            installLocation:
                                '/home/testuser/.claude/plugins/marketplaces/claude-marketplace',
                        },
                    },
                };

                vi.mocked(fs.existsSync).mockReturnValue(true);
                vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(claudeMarketplaces));

                const result = loadClaudeCodeMarketplaces();

                expect(result).toHaveLength(1);
                expect(result[0]!.name).toBe('claude-marketplace');
            });
        });

        describe('getAllMarketplacesWithClaudeCode', () => {
            it('combines Dexto and Claude Code marketplaces', () => {
                const dextoMarketplaces = {
                    version: 1,
                    marketplaces: {
                        'dexto-market': {
                            name: 'dexto-market',
                            source: { type: 'github', value: 'dexto/plugins' },
                            installLocation:
                                '/home/testuser/.dexto/plugins/marketplaces/dexto-market',
                        },
                    },
                };

                const claudeMarketplaces = {
                    version: 1,
                    marketplaces: {
                        'claude-market': {
                            name: 'claude-market',
                            source: { type: 'github', value: 'anthropics/plugins' },
                            installLocation:
                                '/home/testuser/.claude/plugins/marketplaces/claude-market',
                        },
                    },
                };

                vi.mocked(fs.existsSync).mockReturnValue(true);
                vi.mocked(fs.readFileSync).mockImplementation((p) => {
                    const pathStr = typeof p === 'string' ? p : p.toString();
                    if (pathStr.includes('.dexto')) {
                        return JSON.stringify(dextoMarketplaces);
                    }
                    return JSON.stringify(claudeMarketplaces);
                });

                const result = getAllMarketplacesWithClaudeCode();

                expect(result).toHaveLength(2);
                expect(result.map((m) => m.name)).toContain('dexto-market');
                expect(result.map((m) => m.name)).toContain('claude-market');
            });

            it('prefers Dexto marketplaces over Claude Code for duplicates', () => {
                const dextoMarketplaces = {
                    version: 1,
                    marketplaces: {
                        'shared-market': {
                            name: 'shared-market',
                            source: { type: 'github', value: 'dexto/shared' },
                            installLocation:
                                '/home/testuser/.dexto/plugins/marketplaces/shared-market',
                        },
                    },
                };

                const claudeMarketplaces = {
                    version: 1,
                    marketplaces: {
                        'shared-market': {
                            name: 'shared-market',
                            source: { type: 'github', value: 'claude/shared' },
                            installLocation:
                                '/home/testuser/.claude/plugins/marketplaces/shared-market',
                        },
                    },
                };

                vi.mocked(fs.existsSync).mockReturnValue(true);
                vi.mocked(fs.readFileSync).mockImplementation((p) => {
                    const pathStr = typeof p === 'string' ? p : p.toString();
                    if (pathStr.includes('.dexto')) {
                        return JSON.stringify(dextoMarketplaces);
                    }
                    return JSON.stringify(claudeMarketplaces);
                });

                const result = getAllMarketplacesWithClaudeCode();

                expect(result).toHaveLength(1);
                expect(result[0]!.source.value).toBe('dexto/shared');
            });
        });
    });

    describe('addMarketplaceEntry', () => {
        it('adds entry to registry', () => {
            const existingData = { version: 1, marketplaces: {} };
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingData));

            const newEntry: MarketplaceEntry = {
                name: 'new-marketplace',
                source: { type: 'github', value: 'owner/repo' },
                installLocation: '/path/to/marketplace',
            };

            addMarketplaceEntry(newEntry);

            expect(fs.writeFileSync).toHaveBeenCalled();
            const writtenData = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0]![1] as string);
            expect(writtenData.marketplaces['new-marketplace']).toEqual(newEntry);
        });
    });

    describe('removeMarketplaceEntry', () => {
        it('removes entry from registry and returns true', () => {
            const existingData = {
                version: 1,
                marketplaces: {
                    'to-remove': {
                        name: 'to-remove',
                        source: { type: 'github', value: 'owner/repo' },
                        installLocation: '/path',
                    },
                },
            };
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingData));

            const result = removeMarketplaceEntry('to-remove');

            expect(result).toBe(true);
            expect(fs.writeFileSync).toHaveBeenCalled();
            const writtenData = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0]![1] as string);
            expect(writtenData.marketplaces['to-remove']).toBeUndefined();
        });

        it('returns false when entry does not exist', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(
                JSON.stringify({ version: 1, marketplaces: {} })
            );

            const result = removeMarketplaceEntry('nonexistent');

            expect(result).toBe(false);
            expect(fs.writeFileSync).not.toHaveBeenCalled();
        });
    });

    describe('updateMarketplaceTimestamp', () => {
        it('updates lastUpdated field', () => {
            const existingData = {
                version: 1,
                marketplaces: {
                    'test-market': {
                        name: 'test-market',
                        source: { type: 'github', value: 'owner/repo' },
                        installLocation: '/path',
                        lastUpdated: '2025-01-01T00:00:00.000Z',
                    },
                },
            };
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingData));

            updateMarketplaceTimestamp('test-market');

            expect(fs.writeFileSync).toHaveBeenCalled();
            const writtenData = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0]![1] as string);
            const updatedTimestamp = writtenData.marketplaces['test-market'].lastUpdated;
            expect(new Date(updatedTimestamp).getFullYear()).toBeGreaterThanOrEqual(2026);
        });

        it('does nothing when marketplace does not exist', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(
                JSON.stringify({ version: 1, marketplaces: {} })
            );

            updateMarketplaceTimestamp('nonexistent');

            expect(fs.writeFileSync).not.toHaveBeenCalled();
        });
    });

    describe('DEFAULT_MARKETPLACES', () => {
        it('includes claude-plugins-official marketplace', () => {
            expect(DEFAULT_MARKETPLACES).toContainEqual({
                name: 'claude-plugins-official',
                source: {
                    type: 'github',
                    value: 'anthropics/claude-plugins-official',
                },
            });
        });

        it('has at least one default marketplace', () => {
            expect(DEFAULT_MARKETPLACES.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('getUninstalledDefaults', () => {
        it('returns all defaults when none are installed', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(
                JSON.stringify({ version: 1, marketplaces: {} })
            );

            const result = getUninstalledDefaults();

            expect(result.length).toBe(DEFAULT_MARKETPLACES.length);
            expect(result[0]!.isDefault).toBe(true);
        });

        it('returns empty array when all defaults are installed', () => {
            const installedMarketplaces: Record<string, MarketplaceEntry> = {};
            for (const def of DEFAULT_MARKETPLACES) {
                installedMarketplaces[def.name] = {
                    name: def.name,
                    source: def.source,
                    installLocation: `/path/to/${def.name}`,
                };
            }

            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(
                JSON.stringify({ version: 1, marketplaces: installedMarketplaces })
            );

            const result = getUninstalledDefaults();

            expect(result).toHaveLength(0);
        });

        it('returns only uninstalled defaults', () => {
            // Install first default, leave others uninstalled
            const firstDefault = DEFAULT_MARKETPLACES[0]!;
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(
                JSON.stringify({
                    version: 1,
                    marketplaces: {
                        [firstDefault.name]: {
                            name: firstDefault.name,
                            source: firstDefault.source,
                            installLocation: `/path/to/${firstDefault.name}`,
                        },
                    },
                })
            );

            const result = getUninstalledDefaults();

            expect(result.length).toBe(DEFAULT_MARKETPLACES.length - 1);
            expect(result.find((d) => d.name === firstDefault.name)).toBeUndefined();
        });
    });

    describe('isDefaultMarketplace', () => {
        it('returns true for default marketplace names', () => {
            for (const def of DEFAULT_MARKETPLACES) {
                expect(isDefaultMarketplace(def.name)).toBe(true);
            }
        });

        it('returns false for non-default marketplace names', () => {
            expect(isDefaultMarketplace('custom-marketplace')).toBe(false);
            expect(isDefaultMarketplace('my-plugins')).toBe(false);
        });
    });
});
