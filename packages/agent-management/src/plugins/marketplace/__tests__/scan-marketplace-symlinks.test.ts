/**
 * Marketplace scanning against a real directory tree (no mocked fs), for symlink handling.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
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
        expect(sourcesOf()).toHaveLength(1);
    });

    it('works when the marketplace directory itself sits behind a symlink', () => {
        const linkToMarketplace = path.join(base, 'marketplace-link');
        symlinkSync(marketplace, linkToMarketplace);
        writeManifest(['./plugins/inside']);
        expect(scanMarketplacePlugins(linkToMarketplace, 'test').map((p) => p.name)).toEqual([
            'plugin-0',
        ]);
    });
});
