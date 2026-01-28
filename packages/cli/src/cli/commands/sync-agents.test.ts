import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { shouldPromptForSync, markSyncDismissed, clearSyncDismissed } from './sync-agents.js';

// Mock fs module
vi.mock('fs', async () => {
    const actual = await vi.importActual('fs');
    return {
        ...actual,
        promises: {
            readFile: vi.fn(),
            writeFile: vi.fn(),
            mkdir: vi.fn(),
            readdir: vi.fn(),
            stat: vi.fn(),
            access: vi.fn(),
            unlink: vi.fn(),
        },
    };
});

// Mock agent-management
const mockLoadBundledRegistryAgents = vi.fn();
const mockResolveBundledScript = vi.fn();

vi.mock('@dexto/agent-management', () => ({
    getDextoGlobalPath: vi.fn((type: string, filename?: string) => {
        if (type === 'agents') return '/mock/.dexto/agents';
        if (type === 'cache')
            return filename ? `/mock/.dexto/cache/${filename}` : '/mock/.dexto/cache';
        return '/mock/.dexto';
    }),
    loadBundledRegistryAgents: () => mockLoadBundledRegistryAgents(),
    resolveBundledScript: (path: string) => mockResolveBundledScript(path),
    copyDirectory: vi.fn(),
}));

describe('sync-agents', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('shouldPromptForSync', () => {
        it('returns false when sync was dismissed for current version', async () => {
            vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ version: '1.0.0' }));

            const result = await shouldPromptForSync('1.0.0');

            expect(result).toBe(false);
        });

        it('checks for updates when not dismissed', async () => {
            // Dismissed file doesn't exist
            vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

            // No installed agents
            vi.mocked(fs.readdir).mockResolvedValue([]);

            mockLoadBundledRegistryAgents.mockReturnValue({
                'test-agent': { id: 'test-agent', name: 'Test Agent', source: 'test-agent/' },
            });

            const result = await shouldPromptForSync('1.0.0');

            expect(result).toBe(false); // No installed agents = nothing to sync
        });

        it('returns true when installed agent differs from bundled', async () => {
            // Not dismissed
            vi.mocked(fs.readFile).mockImplementation(async (path) => {
                if (String(path).includes('sync-dismissed')) {
                    throw new Error('ENOENT');
                }
                // Return different content for bundled vs installed to simulate hash mismatch
                if (String(path).includes('bundled')) {
                    return Buffer.from('bundled content v2');
                }
                return Buffer.from('installed content v1');
            });

            // One installed agent
            vi.mocked(fs.readdir).mockResolvedValue([
                { name: 'test-agent', isDirectory: () => true } as any,
            ]);

            // Mock stat to return file (not directory) for simpler hash
            vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => false } as any);

            mockLoadBundledRegistryAgents.mockReturnValue({
                'test-agent': {
                    id: 'test-agent',
                    name: 'Test Agent',
                    source: 'test-agent.yml',
                    description: 'A test agent',
                    author: 'Test',
                    tags: [],
                },
            });

            mockResolveBundledScript.mockReturnValue('/bundled/agents/test-agent.yml');

            const result = await shouldPromptForSync('1.0.0');

            expect(result).toBe(true);
        });

        it('returns false when all installed agents match bundled', async () => {
            // Not dismissed
            vi.mocked(fs.readFile).mockImplementation(async (path) => {
                if (String(path).includes('sync-dismissed')) {
                    throw new Error('ENOENT');
                }
                // Return same content for both
                return Buffer.from('same content');
            });

            vi.mocked(fs.readdir).mockResolvedValue([
                { name: 'test-agent', isDirectory: () => true } as any,
            ]);

            vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => false } as any);

            mockLoadBundledRegistryAgents.mockReturnValue({
                'test-agent': {
                    id: 'test-agent',
                    name: 'Test Agent',
                    source: 'test-agent.yml',
                    description: 'A test agent',
                    author: 'Test',
                    tags: [],
                },
            });

            mockResolveBundledScript.mockReturnValue('/bundled/agents/test-agent.yml');

            const result = await shouldPromptForSync('1.0.0');

            expect(result).toBe(false);
        });

        it('skips custom agents not in bundled registry', async () => {
            // Not dismissed
            vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

            // Custom agent installed but not in bundled registry
            vi.mocked(fs.readdir).mockResolvedValue([
                { name: 'my-custom-agent', isDirectory: () => true } as any,
            ]);

            mockLoadBundledRegistryAgents.mockReturnValue({
                'test-agent': { id: 'test-agent', name: 'Test Agent', source: 'test-agent/' },
            });

            const result = await shouldPromptForSync('1.0.0');

            expect(result).toBe(false); // Custom agent is skipped
        });

        it('returns false on error', async () => {
            vi.mocked(fs.readFile).mockRejectedValue(new Error('Some error'));
            mockLoadBundledRegistryAgents.mockImplementation(() => {
                throw new Error('Registry error');
            });

            const result = await shouldPromptForSync('1.0.0');

            expect(result).toBe(false);
        });
    });

    describe('markSyncDismissed', () => {
        it('writes dismissed state to file', async () => {
            vi.mocked(fs.mkdir).mockResolvedValue(undefined);
            vi.mocked(fs.writeFile).mockResolvedValue();

            await markSyncDismissed('1.5.0');

            expect(fs.writeFile).toHaveBeenCalledWith(
                expect.stringContaining('sync-dismissed.json'),
                JSON.stringify({ version: '1.5.0' })
            );
        });

        it('does not throw on error', async () => {
            vi.mocked(fs.mkdir).mockRejectedValue(new Error('Permission denied'));

            await expect(markSyncDismissed('1.5.0')).resolves.not.toThrow();
        });
    });

    describe('clearSyncDismissed', () => {
        it('removes dismissed state file', async () => {
            vi.mocked(fs.unlink).mockResolvedValue();

            await clearSyncDismissed();

            expect(fs.unlink).toHaveBeenCalledWith(expect.stringContaining('sync-dismissed.json'));
        });

        it('does not throw when file does not exist', async () => {
            const error = new Error('ENOENT') as NodeJS.ErrnoException;
            error.code = 'ENOENT';
            vi.mocked(fs.unlink).mockRejectedValue(error);

            await expect(clearSyncDismissed()).resolves.not.toThrow();
        });
    });
});
