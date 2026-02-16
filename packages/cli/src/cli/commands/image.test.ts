import path from 'node:path';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../utils/image-store.js', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return {
        ...actual,
        installImageToStore: vi.fn(),
    };
});

import {
    getImagePackageInstallDir,
    loadImageRegistry,
    saveImageRegistry,
} from '@dexto/agent-management';
import { installImageToStore } from '../utils/image-store.js';
import {
    handleImageDoctorCommand,
    handleImageInstallCommand,
    handleImageListCommand,
    handleImageRemoveCommand,
    handleImageUseCommand,
} from './image.js';

async function makeTempStoreDir(): Promise<string> {
    return fs.mkdtemp(path.join(tmpdir(), 'dexto-image-store-cmd-'));
}

describe('image commands', () => {
    let storeDir: string;
    let logSpy: ReturnType<typeof vi.spyOn>;
    let logs: string[];

    beforeEach(async () => {
        storeDir = await makeTempStoreDir();
        process.env.DEXTO_IMAGE_STORE_DIR = storeDir;

        logs = [];
        logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
            logs.push(args.map(String).join(' '));
        });
    });

    afterEach(async () => {
        logSpy.mockRestore();
        delete process.env.DEXTO_IMAGE_STORE_DIR;
        await fs.rm(storeDir, { recursive: true, force: true });
        vi.clearAllMocks();
    });

    it('installs an image (delegates to store install)', async () => {
        vi.mocked(installImageToStore).mockResolvedValue({
            id: '@myorg/my-image',
            version: '1.2.3',
            entryFile: 'file:///tmp/my-image/dist/index.js',
            installDir: path.join(storeDir, 'packages', '@myorg', 'my-image', '1.2.3'),
            installMode: 'store',
        });

        await handleImageInstallCommand({
            image: '@myorg/my-image@1.2.3',
            force: true,
            activate: false,
        });

        expect(installImageToStore).toHaveBeenCalledWith('@myorg/my-image@1.2.3', {
            force: true,
            activate: false,
        });
        expect(logs.join('\n')).toContain('Installed');
        expect(logs.join('\n')).toContain('@myorg/my-image@1.2.3');
    });

    it('lists images (empty state)', async () => {
        await handleImageListCommand();
        const output = logs.join('\n');
        expect(output).toContain('No images installed.');
        expect(output).toContain('dexto image install');
    });

    it('lists images (installed)', async () => {
        await saveImageRegistry(
            {
                version: 1,
                images: {
                    '@myorg/my-image': {
                        active: '1.0.0',
                        installed: {
                            '1.0.0': {
                                entryFile: 'file:///tmp/my-image/dist/index.js',
                                installedAt: new Date('2026-02-11T00:00:00.000Z').toISOString(),
                            },
                        },
                    },
                },
            },
            storeDir
        );

        await handleImageListCommand();
        const output = logs.join('\n');
        expect(output).toContain('@myorg/my-image');
        expect(output).toContain('1.0.0');
    });

    it('sets active version (image use)', async () => {
        await saveImageRegistry(
            {
                version: 1,
                images: {
                    '@myorg/my-image': {
                        installed: {
                            '2.0.0': {
                                entryFile: 'file:///tmp/my-image/dist/index.js',
                                installedAt: new Date('2026-02-11T00:00:00.000Z').toISOString(),
                            },
                        },
                    },
                },
            },
            storeDir
        );

        await handleImageUseCommand({ image: '@myorg/my-image@2.0.0' });

        const registry = loadImageRegistry(storeDir);
        expect(registry.images['@myorg/my-image']?.active).toBe('2.0.0');
    });

    it('removes a specific version (image remove image@version)', async () => {
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
                                entryFile: 'file:///tmp/my-image/dist/index.js',
                                installedAt: new Date('2026-02-11T00:00:00.000Z').toISOString(),
                            },
                        },
                    },
                },
            },
            storeDir
        );

        await handleImageRemoveCommand({ image: '@myorg/my-image@1.0.0' });
        const registry = loadImageRegistry(storeDir);
        expect(registry.images['@myorg/my-image']).toBeUndefined();
    });

    it('prints doctor output', async () => {
        await handleImageDoctorCommand();
        const output = logs.join('\n');
        expect(output).toContain(storeDir);
        expect(output).toContain('registry.json');
        expect(output).toContain('packages');
    });
});
