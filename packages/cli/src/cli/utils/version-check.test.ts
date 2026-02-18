import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { checkForUpdates, displayUpdateNotification } from './version-check.js';

// Mock fs module
vi.mock('fs', async () => {
    const actual = await vi.importActual('fs');
    return {
        ...actual,
        promises: {
            readFile: vi.fn(),
            writeFile: vi.fn(),
            mkdir: vi.fn(),
        },
    };
});

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock getDextoGlobalPath
vi.mock('@dexto/agent-management', () => ({
    getDextoGlobalPath: vi.fn((_type: string, filename?: string) =>
        filename ? `/mock/.dexto/cache/${filename}` : '/mock/.dexto/cache'
    ),
}));

describe('version-check', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.DEXTO_NO_UPDATE_CHECK;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('checkForUpdates', () => {
        it('returns null when DEXTO_NO_UPDATE_CHECK is set', async () => {
            process.env.DEXTO_NO_UPDATE_CHECK = 'true';

            const result = await checkForUpdates('1.0.0');

            expect(result).toBeNull();
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('returns update info when newer version available from registry', async () => {
            // No cache - force fetch
            vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
            vi.mocked(fs.writeFile).mockResolvedValue();
            vi.mocked(fs.mkdir).mockResolvedValue(undefined);

            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ version: '2.0.0' }),
            });

            const result = await checkForUpdates('1.0.0');

            expect(result).toEqual({
                current: '1.0.0',
                latest: '2.0.0',
                updateCommand: 'bun add -g dexto@latest',
            });
        });

        it('returns null when current version matches latest', async () => {
            vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
            vi.mocked(fs.writeFile).mockResolvedValue();
            vi.mocked(fs.mkdir).mockResolvedValue(undefined);

            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ version: '1.0.0' }),
            });

            const result = await checkForUpdates('1.0.0');

            expect(result).toBeNull();
        });

        it('returns null when current version is newer than npm', async () => {
            vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
            vi.mocked(fs.writeFile).mockResolvedValue();
            vi.mocked(fs.mkdir).mockResolvedValue(undefined);

            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ version: '1.0.0' }),
            });

            const result = await checkForUpdates('2.0.0');

            expect(result).toBeNull();
        });

        it('uses cached result when cache is fresh', async () => {
            const freshCache = {
                lastCheck: Date.now() - 1000, // 1 second ago
                latestVersion: '2.0.0',
                currentVersion: '1.0.0',
            };

            vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(freshCache));

            const result = await checkForUpdates('1.0.0');

            expect(result).toEqual({
                current: '1.0.0',
                latest: '2.0.0',
                updateCommand: 'bun add -g dexto@latest',
            });
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('fetches new data when cache is expired', async () => {
            const expiredCache = {
                lastCheck: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
                latestVersion: '1.5.0',
                currentVersion: '1.0.0',
            };

            vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(expiredCache));
            vi.mocked(fs.writeFile).mockResolvedValue();
            vi.mocked(fs.mkdir).mockResolvedValue(undefined);

            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ version: '2.0.0' }),
            });

            const result = await checkForUpdates('1.0.0');

            expect(result).toEqual({
                current: '1.0.0',
                latest: '2.0.0',
                updateCommand: 'bun add -g dexto@latest',
            });
            expect(mockFetch).toHaveBeenCalled();
        });

        it('returns null on network error', async () => {
            vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

            mockFetch.mockRejectedValue(new Error('Network error'));

            const result = await checkForUpdates('1.0.0');

            expect(result).toBeNull();
        });

        it('returns null on non-ok response', async () => {
            vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

            mockFetch.mockResolvedValue({
                ok: false,
                status: 404,
            });

            const result = await checkForUpdates('1.0.0');

            expect(result).toBeNull();
        });
    });

    describe('semver comparison (via checkForUpdates)', () => {
        beforeEach(() => {
            vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
            vi.mocked(fs.writeFile).mockResolvedValue();
            vi.mocked(fs.mkdir).mockResolvedValue(undefined);
        });

        it('correctly identifies major version updates', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ version: '2.0.0' }),
            });

            const result = await checkForUpdates('1.9.9');
            expect(result?.latest).toBe('2.0.0');
        });

        it('correctly identifies minor version updates', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ version: '1.2.0' }),
            });

            const result = await checkForUpdates('1.1.9');
            expect(result?.latest).toBe('1.2.0');
        });

        it('correctly identifies patch version updates', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ version: '1.0.2' }),
            });

            const result = await checkForUpdates('1.0.1');
            expect(result?.latest).toBe('1.0.2');
        });

        it('handles versions with v prefix', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ version: 'v2.0.0' }),
            });

            const result = await checkForUpdates('v1.0.0');
            expect(result?.latest).toBe('v2.0.0');
        });
    });

    describe('displayUpdateNotification', () => {
        it('does not throw', () => {
            // Just verify it doesn't throw - output goes to console
            expect(() =>
                displayUpdateNotification({
                    current: '1.0.0',
                    latest: '2.0.0',
                    updateCommand: 'bun add -g dexto@latest',
                })
            ).not.toThrow();
        });
    });
});
