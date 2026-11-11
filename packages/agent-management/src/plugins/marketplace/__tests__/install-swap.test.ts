/**
 * Installing from a marketplace while the accepted plugin directory is swapped for a link.
 * Uses real directories; only git, the registry and the final install step are replaced.
 */

import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, symlinkSync } from 'fs';
import { existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
    beforeCopy: undefined as (() => void) | undefined,
    afterCopy: undefined as (() => void) | undefined,
    cacheDir: '',
    marketplaceDir: '',
}));

vi.mock('child_process', async () => {
    const actual = await vi.importActual<typeof import('child_process')>('child_process');
    return {
        ...actual,
        // getGitSha runs between the scan and the copy.
        execSync: vi.fn(() => {
            hooks.beforeCopy?.();
            return 'abcdef0123456789\n';
        }),
    };
});

vi.mock('../../../utils/path.js', async () => {
    const actual =
        await vi.importActual<typeof import('../../../utils/path.js')>('../../../utils/path.js');
    return {
        ...actual,
        copyDirectory: vi.fn(async (src: string, dest: string) => {
            await actual.copyDirectory(src, dest);
            hooks.afterCopy?.();
        }),
    };
});

vi.mock('../registry.js', () => ({
    getMarketplaceCacheDir: vi.fn(() => hooks.cacheDir),
    getMarketplaceEntry: vi.fn(() => ({
        name: 'test',
        source: { type: 'local', value: hooks.marketplaceDir },
        installLocation: hooks.marketplaceDir,
    })),
}));

vi.mock('../../install-plugin.js', () => ({
    installPluginFromPath: vi.fn(async () => ({
        success: true,
        pluginName: 'foo',
        installPath: '/installed/foo',
        warnings: [],
    })),
}));

import { installPluginFromMarketplace } from '../install-from-marketplace.js';

describe.skipIf(process.platform === 'win32')('installPluginFromMarketplace swap', () => {
    let base: string;
    let outside: string;
    let pluginDir: string;

    beforeEach(() => {
        base = mkdtempSync(path.join(tmpdir(), 'marketplace-swap-'));
        hooks.marketplaceDir = path.join(base, 'marketplace');
        hooks.cacheDir = path.join(base, 'cache');
        outside = path.join(base, 'outside');
        pluginDir = path.join(hooks.marketplaceDir, 'plugins', 'foo');
        mkdirSync(pluginDir, { recursive: true });
        mkdirSync(outside);
        mkdirSync(hooks.cacheDir);
        writeFileSync(path.join(pluginDir, 'readme.txt'), 'inside');
        writeFileSync(path.join(outside, 'id_rsa'), 'private contents');
        writeFileSync(
            path.join(hooks.marketplaceDir, 'marketplace.json'),
            JSON.stringify({
                name: 'Test',
                plugins: [{ name: 'foo', source: './plugins/foo' }],
            })
        );
    });

    afterEach(() => {
        hooks.beforeCopy = undefined;
        hooks.afterCopy = undefined;
        rmSync(base, { recursive: true, force: true });
    });

    function swapForLink() {
        renameSync(pluginDir, `${pluginDir}.bak`);
        symlinkSync(outside, pluginDir);
    }

    function cachedFiles(): string[] {
        const found: string[] = [];
        const walk = (dir: string) => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) walk(full);
                else found.push(entry.name);
            }
        };
        walk(hooks.cacheDir);
        return found;
    }

    it('installs normally when nothing changes', async () => {
        const result = await installPluginFromMarketplace('foo@test');
        expect(result.success).toBe(true);
        expect(cachedFiles()).toEqual(['readme.txt']);
    });

    it('refuses to copy when the plugin directory is swapped for a link after the scan', async () => {
        hooks.beforeCopy = swapForLink;

        await expect(installPluginFromMarketplace('foo@test')).rejects.toMatchObject({
            code: expect.stringMatching(/copy/i),
        });
        expect(cachedFiles()).not.toContain('id_rsa');
        expect(existsSync(path.join(hooks.cacheDir, 'test', 'foo', 'abcdef01'))).toBe(false);
    });

    it('discards the copy when the directory is swapped while it is being copied', async () => {
        hooks.afterCopy = swapForLink;

        await expect(installPluginFromMarketplace('foo@test')).rejects.toMatchObject({
            code: expect.stringMatching(/copy/i),
        });
        expect(cachedFiles()).toEqual([]);
        expect(existsSync(path.join(hooks.cacheDir, 'test', 'foo', 'abcdef01'))).toBe(false);
    });
});
