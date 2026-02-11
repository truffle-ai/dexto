import path from 'node:path';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { loadImageRegistry } from '@dexto/agent-management';

vi.mock('./execute.js', () => ({
    executeWithTimeout: vi.fn(
        async (_command: string, _args: string[], options: { cwd: string }) => {
            const cwd = options.cwd;

            // Simulate `npm install <specifier>` by:
            // - writing the dependency into package.json
            // - creating node_modules/@myorg/my-image with a valid package.json + dist entry
            const pkgPath = path.join(cwd, 'package.json');
            const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8')) as {
                dependencies?: Record<string, string>;
            };
            pkg.dependencies = { ...(pkg.dependencies ?? {}), '@myorg/my-image': 'file:../mock' };
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
        }
    ),
}));

async function makeTempDir(prefix: string): Promise<string> {
    return fs.mkdtemp(path.join(tmpdir(), prefix));
}

describe('installImageToStore', () => {
    it('installs into the store and writes registry entry (mocked npm)', async () => {
        vi.resetModules();
        const storeDir = await makeTempDir('dexto-image-store-install-');
        try {
            const { installImageToStore } = await import('./image-store.js');

            const result = await installImageToStore('./my-image', { storeDir });

            expect(result.id).toBe('@myorg/my-image');
            expect(result.version).toBe('1.2.3');
            expect(result.entryFile).toContain('/dist/index.js');
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
        }
    });
});
