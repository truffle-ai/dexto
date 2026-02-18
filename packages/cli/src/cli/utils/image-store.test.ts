import path from 'node:path';
import { promises as fs } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { loadImage, setImageImporter } from '@dexto/agent-config';
import { saveImageRegistry } from '@dexto/agent-management';
import { importImageModule } from './image-store.js';

async function makeTempDir(): Promise<string> {
    return fs.mkdtemp(path.join(tmpdir(), 'dexto-image-store-test-'));
}

describe('image-store', () => {
    it('imports file-like specifiers directly', async () => {
        const storeDir = await makeTempDir();
        const modulePath = path.join(storeDir, 'module-file.js');
        await fs.writeFile(modulePath, `export default { ok: true };`, 'utf-8');
        const entryFile = pathToFileURL(modulePath).href;

        const mod = (await importImageModule(entryFile, storeDir)) as { default?: unknown };
        expect(mod.default).toEqual({ ok: true });
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
                `  hooks: {},`,
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
