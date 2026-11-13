import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';

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

import { TERMINALS } from '@dexto/tui/signal-harness';
import { getCaps, setCaps } from '@dexto/tui/signal-text';
import { checkForUpdates, displayUpdateNotification, updateNoticeLines } from './version-check.js';

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

        it('returns update info when newer version available from GitHub releases', async () => {
            // No cache - force fetch
            vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
            vi.mocked(fs.writeFile).mockResolvedValue();
            vi.mocked(fs.mkdir).mockResolvedValue(undefined);

            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ tag_name: 'dexto@2.0.0' }),
            });

            const result = await checkForUpdates('1.0.0');

            expect(result).toEqual({
                current: '1.0.0',
                latest: '2.0.0',
                updateCommand: 'dexto upgrade',
            });
        });

        it('extracts trailing semver from scoped monorepo release tags', async () => {
            vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
            vi.mocked(fs.writeFile).mockResolvedValue();
            vi.mocked(fs.mkdir).mockResolvedValue(undefined);

            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ tag_name: '@dexto/tools-filesystem@2.0.0' }),
            });

            const result = await checkForUpdates('1.0.0');

            expect(result).toEqual({
                current: '1.0.0',
                latest: '2.0.0',
                updateCommand: 'dexto upgrade',
            });
        });

        it('returns null when current version matches latest release', async () => {
            vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
            vi.mocked(fs.writeFile).mockResolvedValue();
            vi.mocked(fs.mkdir).mockResolvedValue(undefined);

            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ tag_name: 'dexto@1.0.0' }),
            });

            const result = await checkForUpdates('1.0.0');

            expect(result).toBeNull();
        });

        it('returns null when current version is newer than latest release', async () => {
            vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
            vi.mocked(fs.writeFile).mockResolvedValue();
            vi.mocked(fs.mkdir).mockResolvedValue(undefined);

            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ tag_name: 'dexto@1.0.0' }),
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
                updateCommand: 'dexto upgrade',
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
                json: () => Promise.resolve({ tag_name: 'dexto@2.0.0' }),
            });

            const result = await checkForUpdates('1.0.0');

            expect(result).toEqual({
                current: '1.0.0',
                latest: '2.0.0',
                updateCommand: 'dexto upgrade',
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

        it('returns null when tag_name does not contain a semver', async () => {
            vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ tag_name: 'latest-release' }),
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
                json: () => Promise.resolve({ tag_name: 'dexto@2.0.0' }),
            });

            const result = await checkForUpdates('1.9.9');
            expect(result?.latest).toBe('2.0.0');
        });

        it('correctly identifies minor version updates', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ tag_name: 'dexto@1.2.0' }),
            });

            const result = await checkForUpdates('1.1.9');
            expect(result?.latest).toBe('1.2.0');
        });

        it('correctly identifies patch version updates', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ tag_name: 'dexto@1.0.2' }),
            });

            const result = await checkForUpdates('1.0.1');
            expect(result?.latest).toBe('1.0.2');
        });

        it('handles versions with v prefix in release tag', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ tag_name: 'dexto@v2.0.0' }),
            });

            const result = await checkForUpdates('v1.0.0');
            expect(result?.latest).toBe('v2.0.0');
        });

        it('returns null when release payload has no tag_name', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({}),
            });

            const result = await checkForUpdates('1.0.0');
            expect(result).toBeNull();
        });
    });

    describe('displayUpdateNotification', () => {
        it('does not throw', () => {
            // Just verify it doesn't throw - output goes to console
            expect(() =>
                displayUpdateNotification({
                    current: '1.0.0',
                    latest: '2.0.0',
                    updateCommand: 'dexto upgrade',
                })
            ).not.toThrow();
        });

        it('prints the fetched version with its control characters taken out', () => {
            const error = vi.spyOn(console, 'error').mockImplementation(() => {});
            try {
                displayUpdateNotification({
                    current: '1.0.0',
                    latest: '2.0.0\u001B[2J\u001B]0;pwned\u0007\u009B2J\u202E',
                    updateCommand: 'dexto upgrade',
                });
                const printed = error.mock.calls.map((call) => String(call[0])).join('\n');
                expect(printed).toContain('2.0.0');
                expect(printed).not.toContain('\u001B[2J');
                expect(printed).not.toContain('\u001B]0;');
                // eslint-disable-next-line no-control-regex
                expect(printed).not.toMatch(/[\u0007\u009B\u202E]/u);
            } finally {
                error.mockRestore();
            }
        });

        describe('on Signal', () => {
            const info = { current: '2.1.0', latest: '2.2.0', updateCommand: 'dexto upgrade' };
            const savedCaps = getCaps();
            const savedIsTTY = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');
            let stderr: string[];
            let stdout: string[];

            beforeEach(() => {
                setCaps(TERMINALS['16-dark']);
                stderr = [];
                stdout = [];
                vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
                    stderr.push(String(chunk));
                    return true;
                });
                vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
                    stdout.push(String(chunk));
                    return true;
                });
                vi.spyOn(console, 'error').mockImplementation(() => undefined);
                vi.spyOn(console, 'log').mockImplementation(() => undefined);
            });

            afterEach(() => {
                vi.restoreAllMocks();
                setCaps(savedCaps);
                if (savedIsTTY === undefined) Reflect.deleteProperty(process.stderr, 'isTTY');
                else Object.defineProperty(process.stderr, 'isTTY', savedIsTTY);
            });

            const stderrIsTTY = (isTTY: boolean | undefined) =>
                Object.defineProperty(process.stderr, 'isTTY', {
                    value: isTTY,
                    configurable: true,
                });

            it('writes the notice to stderr at a terminal, never to stdout', () => {
                stderrIsTTY(true);

                displayUpdateNotification(info);

                expect(stderr).toEqual([`${updateNoticeLines(info).join('\n')}\n`]);
                expect(stderr[0]).toContain('2.2.0');
                expect(stdout).toEqual([]);
                expect(console.error).not.toHaveBeenCalled();
                expect(console.log).not.toHaveBeenCalled();
            });

            it("writes nothing when stderr isn't a terminal", () => {
                for (const isTTY of [false, undefined]) {
                    stderrIsTTY(isTTY);

                    displayUpdateNotification(info);
                }

                expect(stderr).toEqual([]);
                expect(stdout).toEqual([]);
                expect(console.error).not.toHaveBeenCalled();
                expect(console.log).not.toHaveBeenCalled();
            });
        });
    });
});
