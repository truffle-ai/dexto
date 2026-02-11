import path from 'node:path';
import { promises as fs } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { loadImage, setImageImporter } from '@dexto/agent-config';
import {
    importImageModule,
    isFileLikeImageSpecifier,
    loadImageRegistry,
    parseImageSpecifier,
    resolveImageEntryFileFromStore,
    saveImageRegistry,
} from './image-store.js';

async function makeTempDir(): Promise<string> {
    return fs.mkdtemp(path.join(tmpdir(), 'dexto-image-store-test-'));
}

describe('image-store', () => {
    it('parses scoped image specifiers (with and without version)', () => {
        expect(parseImageSpecifier('@dexto/image-local')).toEqual({ id: '@dexto/image-local' });
        expect(parseImageSpecifier('@dexto/image-local@1.2.3')).toEqual({
            id: '@dexto/image-local',
            version: '1.2.3',
        });
    });

    it('parses unscoped image specifiers (with and without version)', () => {
        expect(parseImageSpecifier('image-local')).toEqual({ id: 'image-local' });
        expect(parseImageSpecifier('image-local@1.2.3')).toEqual({
            id: 'image-local',
            version: '1.2.3',
        });
    });

    it('treats file-like specifiers as direct imports', () => {
        expect(isFileLikeImageSpecifier('.')).toBe(true);
        expect(isFileLikeImageSpecifier('file:///tmp/image.js')).toBe(true);
        expect(isFileLikeImageSpecifier('/abs/path/to/image.js')).toBe(true);
        expect(isFileLikeImageSpecifier('./dist/index.js')).toBe(true);
        expect(isFileLikeImageSpecifier('@dexto/image-local')).toBe(false);
    });

    it('resolves entry file from store (active version)', async () => {
        const storeDir = await makeTempDir();
        const entryFile = pathToFileURL(path.join(storeDir, 'dummy.js')).href;

        await saveImageRegistry(
            {
                version: 1,
                images: {
                    '@myorg/my-image': {
                        active: '1.2.3',
                        installed: {
                            '1.2.3': {
                                entryFile,
                                installedAt: new Date('2026-02-11T00:00:00.000Z').toISOString(),
                            },
                        },
                    },
                },
            },
            storeDir
        );

        const resolved = await resolveImageEntryFileFromStore({ id: '@myorg/my-image' }, storeDir);
        expect(resolved).toBe(entryFile);

        const registry = loadImageRegistry(storeDir);
        expect(registry.images['@myorg/my-image']?.active).toBe('1.2.3');
    });

    it('imports modules from store when installed', async () => {
        const storeDir = await makeTempDir();
        const modulePath = path.join(storeDir, 'module.js');
        await fs.writeFile(modulePath, `export default { ok: true };`, 'utf-8');
        const entryFile = pathToFileURL(modulePath).href;

        await saveImageRegistry(
            {
                version: 1,
                images: {
                    '@myorg/my-image': {
                        active: '1.0.0',
                        installed: {
                            '1.0.0': {
                                entryFile,
                                installedAt: new Date('2026-02-11T00:00:00.000Z').toISOString(),
                            },
                        },
                    },
                },
            },
            storeDir
        );

        const mod = (await importImageModule('@myorg/my-image', storeDir)) as { default?: unknown };
        expect(mod.default).toEqual({ ok: true });
    });

    it('loads images via @dexto/agent-config loadImage using the store importer', async () => {
        const storeDir = await makeTempDir();
        const modulePath = path.join(storeDir, 'image.js');
        await fs.writeFile(
            modulePath,
            [
                `const schema = { parse: (value) => value };`,
                `export default {`,
                `  metadata: { name: '@myorg/my-image', version: '1.0.0', description: 'test image' },`,
                `  tools: {},`,
                `  storage: { blob: {}, database: {}, cache: {} },`,
                `  plugins: {},`,
                `  compaction: {},`,
                `  logger: { configSchema: schema, create: () => ({}) },`,
                `};`,
            ].join('\n'),
            'utf-8'
        );
        const entryFile = pathToFileURL(modulePath).href;

        await saveImageRegistry(
            {
                version: 1,
                images: {
                    '@myorg/my-image': {
                        active: '1.0.0',
                        installed: {
                            '1.0.0': {
                                entryFile,
                                installedAt: new Date('2026-02-11T00:00:00.000Z').toISOString(),
                            },
                        },
                    },
                },
            },
            storeDir
        );

        setImageImporter((specifier) => importImageModule(specifier, storeDir));
        try {
            const image = await loadImage('@myorg/my-image');
            expect(image.metadata.name).toBe('@myorg/my-image');
            expect(image.metadata.version).toBe('1.0.0');
        } finally {
            setImageImporter(undefined);
        }
    });

    it('throws a helpful error when a package image cannot be imported', async () => {
        const storeDir = await makeTempDir();
        await expect(importImageModule('@myorg/does-not-exist', storeDir)).rejects.toThrow(
            /dexto image install/
        );
    });
});
