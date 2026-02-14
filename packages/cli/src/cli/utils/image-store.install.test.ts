import path from 'node:path';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadImageRegistry } from '@dexto/agent-management';

vi.mock('./execute.js', () => ({
    executeWithTimeout: vi.fn(
        async (_command: string, args: string[], options: { cwd: string }) => {
            const cwd = options.cwd;

            if (args[0] === 'pack') {
                const destIndex = args.indexOf('--pack-destination');
                const dest = destIndex >= 0 ? args[destIndex + 1] : undefined;
                if (!dest) {
                    throw new Error('Test mock expected npm pack to include --pack-destination');
                }

                await fs.mkdir(dest, { recursive: true });
                await fs.writeFile(path.join(dest, 'myorg-my-image-1.2.3.tgz'), 'tgz', 'utf-8');
                return;
            }

            if (args[0] === 'install') {
                // Simulate `npm install <specifier>` by:
                // - writing the dependency into package.json
                // - creating node_modules/@myorg/my-image with a valid package.json + dist entry
                const pkgPath = path.join(cwd, 'package.json');
                const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8')) as {
                    dependencies?: Record<string, string>;
                };
                pkg.dependencies = {
                    ...(pkg.dependencies ?? {}),
                    '@myorg/my-image': 'file:../mock',
                };
                await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2), 'utf-8');

                const imageRoot = path.join(cwd, 'node_modules', '@myorg', 'my-image');
                await fs.mkdir(path.join(imageRoot, 'dist'), { recursive: true });
                await fs.writeFile(
                    path.join(imageRoot, 'dist', 'index.js'),
                    [
                        `const schema = { parse: (value) => value };`,
                        `export default {`,
                        `  metadata: { name: '@myorg/my-image', version: '1.2.3', description: 'test image' },`,
                        `  tools: {},`,
                        `  storage: { blob: {}, database: {}, cache: {} },`,
                        `  plugins: {},`,
                        `  compaction: {},`,
                        `  logger: { configSchema: schema, create: () => ({}) },`,
                        `};`,
                    ].join('\n'),
                    'utf-8'
                );
                await fs.writeFile(
                    path.join(imageRoot, 'package.json'),
                    JSON.stringify(
                        {
                            name: '@myorg/my-image',
                            version: '1.2.3',
                            exports: { '.': { import: './dist/index.js' } },
                        },
                        null,
                        2
                    ),
                    'utf-8'
                );
                return;
            }

            throw new Error(`Unexpected npm args: ${args.join(' ')}`);
        }
    ),
}));

async function makeTempDir(prefix: string): Promise<string> {
    return fs.mkdtemp(path.join(tmpdir(), prefix));
}

describe('installImageToStore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('installs into the store and writes registry entry (mocked npm)', async () => {
        const storeDir = await makeTempDir('dexto-image-store-install-');
        const imageDir = await makeTempDir('dexto-image-store-image-src-');
        try {
            const { installImageToStore } = await import('./image-store.js');

            const result = await installImageToStore(imageDir, { storeDir });

            expect(result.id).toBe('@myorg/my-image');
            expect(result.version).toBe('1.2.3');
            expect(result.entryFile).toContain('/dist/index.js');
            expect(result.installMode).toBe('store');
            expect(result.installDir).toContain(
                path.join('packages', '@myorg', 'my-image', '1.2.3')
            );

            const registry = loadImageRegistry(storeDir);
            expect(registry.images['@myorg/my-image']?.active).toBe('1.2.3');
            expect(registry.images['@myorg/my-image']?.installed['1.2.3']?.entryFile).toBe(
                result.entryFile
            );
        } finally {
            await fs.rm(storeDir, { recursive: true, force: true });
            await fs.rm(imageDir, { recursive: true, force: true });
        }
    });

    it('links directory images that use workspace:* dependencies (monorepo dev)', async () => {
        const storeDir = await makeTempDir('dexto-image-store-install-');
        const imageDir = await makeTempDir('dexto-image-store-image-src-');
        try {
            const { installImageToStore } = await import('./image-store.js');
            const { executeWithTimeout } = await import('./execute.js');

            await fs.mkdir(path.join(imageDir, 'dist'), { recursive: true });
            await fs.writeFile(
                path.join(imageDir, 'dist', 'index.js'),
                [
                    `const schema = { parse: (value) => value };`,
                    `export default {`,
                    `  metadata: { name: '@myorg/workspace-image', version: '0.0.1', description: 'test image' },`,
                    `  tools: {},`,
                    `  storage: { blob: {}, database: {}, cache: {} },`,
                    `  plugins: {},`,
                    `  compaction: {},`,
                    `  logger: { configSchema: schema, create: () => ({}) },`,
                    `};`,
                ].join('\n'),
                'utf-8'
            );

            await fs.writeFile(
                path.join(imageDir, 'package.json'),
                JSON.stringify(
                    {
                        name: '@myorg/workspace-image',
                        version: '0.0.1',
                        type: 'module',
                        dependencies: {
                            '@dexto/core': 'workspace:*',
                        },
                    },
                    null,
                    2
                ),
                'utf-8'
            );

            const result = await installImageToStore(imageDir, { storeDir });
            expect(result.installMode).toBe('linked');
            expect(result.installDir).toBe(imageDir);
            expect(result.entryFile).toContain('/dist/index.js');

            expect(vi.mocked(executeWithTimeout)).not.toHaveBeenCalled();

            const registry = loadImageRegistry(storeDir);
            expect(registry.images['@myorg/workspace-image']?.active).toBe('0.0.1');
            expect(registry.images['@myorg/workspace-image']?.installed['0.0.1']?.entryFile).toBe(
                result.entryFile
            );
        } finally {
            await fs.rm(storeDir, { recursive: true, force: true });
            await fs.rm(imageDir, { recursive: true, force: true });
        }
    });
});
