import path from 'path';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import { describe, expect, it } from 'vitest';
import {
    getImagePackageInstallDir,
    isFileLikeImageSpecifier,
    loadImageRegistry,
    parseImageSpecifier,
    removeImageFromStore,
    resolveFileLikeImageSpecifierToFileUrl,
    resolveFileLikeImageSpecifierToPath,
    resolveImageEntryFileFromStore,
    saveImageRegistry,
    setActiveImageVersion,
} from './image-store.js';

async function makeTempDir(): Promise<string> {
    return fs.mkdtemp(path.join(tmpdir(), 'dexto-image-store-test-'));
}

describe('image-store (agent-management)', () => {
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

    it('resolves file-like specifiers to absolute paths and file URLs', async () => {
        const cwd = await makeTempDir();
        const filePath = path.join(cwd, 'dist', 'index.js');
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, `export default {};`, 'utf-8');

        expect(resolveFileLikeImageSpecifierToPath('./dist/index.js', cwd)).toBe(filePath);
        expect(resolveFileLikeImageSpecifierToFileUrl('./dist/index.js', cwd)).toBe(
            pathToFileURL(filePath).href
        );
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
    });

    it('updates active version', async () => {
        const storeDir = await makeTempDir();
        const entryFile = pathToFileURL(path.join(storeDir, 'dummy.js')).href;

        await saveImageRegistry(
            {
                version: 1,
                images: {
                    '@myorg/my-image': {
                        installed: {
                            '1.0.0': {
                                entryFile,
                                installedAt: new Date('2026-02-11T00:00:00.000Z').toISOString(),
                            },
                            '2.0.0': {
                                entryFile,
                                installedAt: new Date('2026-02-11T00:00:00.000Z').toISOString(),
                            },
                        },
                    },
                },
            },
            storeDir
        );

        await setActiveImageVersion('@myorg/my-image', '2.0.0', storeDir);

        const registry = loadImageRegistry(storeDir);
        expect(registry.images['@myorg/my-image']?.active).toBe('2.0.0');
    });

    it('removes an installed image version', async () => {
        const storeDir = await makeTempDir();
        const entryFile = pathToFileURL(path.join(storeDir, 'dummy.js')).href;
        const installDir = getImagePackageInstallDir('@myorg/my-image', '1.0.0', storeDir);
        await fs.mkdir(installDir, { recursive: true });

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

        await removeImageFromStore('@myorg/my-image', { version: '1.0.0', storeDir });

        const registry = loadImageRegistry(storeDir);
        expect(registry.images['@myorg/my-image']).toBeUndefined();
    });
});
