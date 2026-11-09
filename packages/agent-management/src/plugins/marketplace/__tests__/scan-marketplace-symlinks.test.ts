/**
 * Marketplace scanning against a real directory tree (no mocked fs), for symlink handling.
 */

import {
    chmodSync,
    mkdirSync,
    mkdtempSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanMarketplacePlugins } from '../operations.js';

describe('scanMarketplacePlugins with symlinks', () => {
    let base: string;
    let marketplace: string;
    let outside: string;

    beforeEach(() => {
        base = mkdtempSync(path.join(tmpdir(), 'marketplace-scan-'));
        marketplace = path.join(base, 'marketplace');
        outside = path.join(base, 'outside');
        mkdirSync(path.join(marketplace, 'plugins', 'inside'), { recursive: true });
        mkdirSync(path.join(outside, 'nested'), { recursive: true });
    });

    afterEach(() => {
        rmSync(base, { recursive: true, force: true });
    });

    function writeManifest(sources: string[]) {
        const plugins = sources.map((source, index) => ({ name: `plugin-${index}`, source }));
        writeFileSync(
            path.join(marketplace, 'marketplace.json'),
            JSON.stringify({ name: 'Test Marketplace', plugins })
        );
    }

    const sourcesOf = () => scanMarketplacePlugins(marketplace, 'test').map((p) => p.sourcePath);

    it('keeps a real directory inside the marketplace', () => {
        writeManifest(['./plugins/inside']);
        expect(sourcesOf()).toEqual([path.join(marketplace, 'plugins', 'inside')]);
    });

    it('skips a source that is a symlink to a directory outside the marketplace', () => {
        symlinkSync(outside, path.join(marketplace, 'plugins', 'dirlink'));
        writeManifest(['./plugins/dirlink']);
        expect(sourcesOf()).toEqual([]);
    });

    it('skips a source that goes through a symlink to a directory outside the marketplace', () => {
        symlinkSync(outside, path.join(marketplace, 'linkdir'));
        writeManifest(['linkdir/nested']);
        expect(sourcesOf()).toEqual([]);
    });

    it('keeps a symlink that stays inside the marketplace', () => {
        symlinkSync(
            path.join(marketplace, 'plugins', 'inside'),
            path.join(marketplace, 'plugins', 'alias')
        );
        writeManifest(['./plugins/alias']);
        // The returned path is the checked real path, so that is what gets copied.
        expect(sourcesOf()).toEqual([realpathSync(path.join(marketplace, 'plugins', 'inside'))]);
    });

    it('works when the marketplace directory itself sits behind a symlink', () => {
        const linkToMarketplace = path.join(base, 'marketplace-link');
        symlinkSync(marketplace, linkToMarketplace);
        writeManifest(['./plugins/inside']);
        expect(scanMarketplacePlugins(linkToMarketplace, 'test').map((p) => p.name)).toEqual([
            'plugin-0',
        ]);
    });

    describe('when there is no marketplace.json', () => {
        function writePluginManifest(directory: string, name: string) {
            mkdirSync(path.join(directory, '.claude-plugin'), { recursive: true });
            writeFileSync(
                path.join(directory, '.claude-plugin', 'plugin.json'),
                JSON.stringify({ name })
            );
        }

        const namesOf = () => scanMarketplacePlugins(marketplace, 'test').map((p) => p.name);

        it('finds plugins in plugins/ and at the root, returning real paths', () => {
            writePluginManifest(path.join(marketplace, 'plugins', 'inside'), 'in-plugins');
            writePluginManifest(path.join(marketplace, 'rootplugin'), 'at-root');
            expect(
                scanMarketplacePlugins(marketplace, 'test').map((p) => [p.name, p.sourcePath])
            ).toEqual([
                ['in-plugins', realpathSync(path.join(marketplace, 'plugins', 'inside'))],
                ['at-root', realpathSync(path.join(marketplace, 'rootplugin'))],
            ]);
        });

        it('skips plugins when plugins/ itself is a symlink to a directory outside', () => {
            rmSync(path.join(marketplace, 'plugins'), { recursive: true });
            writePluginManifest(path.join(outside, 'stolen'), 'outside-plugin');
            symlinkSync(outside, path.join(marketplace, 'plugins'));
            expect(namesOf()).toEqual([]);
        });

        it('skips a root-level directory that is a symlink to a directory outside', () => {
            writePluginManifest(path.join(outside, 'stolen'), 'outside-plugin');
            symlinkSync(path.join(outside, 'stolen'), path.join(marketplace, 'rootlink'));
            expect(namesOf()).toEqual([]);
        });

        it('skips an entry under external_plugins/ that is a symlink to a directory outside', () => {
            mkdirSync(path.join(marketplace, 'external_plugins'));
            writePluginManifest(path.join(outside, 'stolen'), 'outside-plugin');
            symlinkSync(
                path.join(outside, 'stolen'),
                path.join(marketplace, 'external_plugins', 'linked')
            );
            expect(namesOf()).toEqual([]);
        });
    });

    describe('when a path cannot be resolved', () => {
        it('skips a source that does not exist and a dangling symlink', () => {
            symlinkSync(path.join(base, 'missing'), path.join(marketplace, 'plugins', 'dangling'));
            writeManifest(['./plugins/missing', './plugins/dangling']);
            expect(sourcesOf()).toEqual([]);
        });

        it('returns nothing when the marketplace directory is missing', () => {
            expect(scanMarketplacePlugins(path.join(base, 'no-such-marketplace'), 'test')).toEqual(
                []
            );
        });

        it.skipIf(process.getuid?.() === 0)(
            'skips a source it is not allowed to resolve instead of accepting it',
            () => {
                writeManifest(['./plugins/inside']);
                chmodSync(path.join(marketplace, 'plugins'), 0o000);
                try {
                    expect(sourcesOf()).toEqual([]);
                } finally {
                    chmodSync(path.join(marketplace, 'plugins'), 0o755);
                }
            }
        );
    });
});
