import { describe, expect, it, vi } from 'vitest';
import { bundle } from '../src/index.js';
import { loadImage } from '@dexto/agent-config';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function writeFileEnsuringDir(filePath: string, contents: string): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, contents, 'utf-8');
}

describe('@dexto/image-bundler - bundle (integration)', () => {
    it('bundles a convention-based image into a loadable DextoImage', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        const tempDir = await mkdtemp(
            path.join(process.cwd(), 'packages/image-bundler', '.tmp-bundle-test-')
        );

        try {
            await writeFileEnsuringDir(
                path.join(tempDir, 'package.json'),
                JSON.stringify(
                    {
                        name: '@dexto/test-image',
                        version: '1.0.0',
                        type: 'module',
                    },
                    null,
                    2
                )
            );

            await writeFileEnsuringDir(
                path.join(tempDir, 'dexto.image.ts'),
                `import type { ImageDefinition } from '@dexto/image-bundler';

const image = {
    name: 'test-image',
    version: '1.0.0',
    description: 'Test image for bundler integration',
    target: 'local-development',
    constraints: ['offline-capable'],
} satisfies ImageDefinition;

export default image;
`
            );

            await writeFileEnsuringDir(
                path.join(tempDir, 'tools', 'example-tool', 'index.ts'),
                `const configSchema = {
    parse: (value: unknown) => value,
};

const inputSchema = {
    parse: (value: unknown) => value,
};

export const factory = {
    configSchema,
    create: (_config: unknown) => {
        const tool = {
            id: 'example-tool',
            description: 'Example tool from bundler integration test',
            inputSchema,
            execute: async (_input: unknown) => {
                return { ok: true };
            },
        };

        return [tool];
    },
};
`
            );

            const distDir = path.join(tempDir, 'dist');
            const result = await bundle({
                imagePath: path.join(tempDir, 'dexto.image.ts'),
                outDir: distDir,
            });

            expect(result.entryFile).toBe(path.join(distDir, 'index.js'));
            expect(result.typesFile).toBe(path.join(distDir, 'index.d.ts'));

            const image = await loadImage(pathToFileURL(result.entryFile).href);
            expect(image.metadata.name).toBe('test-image');
            expect(image.tools['example-tool']).toBeDefined();
        } finally {
            await rm(tempDir, { recursive: true, force: true });
            logSpy.mockRestore();
            warnSpy.mockRestore();
        }
    }, 20000);

    it('bundles an image with tools/storage/hooks/compaction factories', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        const tempDir = await mkdtemp(
            path.join(process.cwd(), 'packages/image-bundler', '.tmp-bundle-test-')
        );

        try {
            await writeFileEnsuringDir(
                path.join(tempDir, 'package.json'),
                JSON.stringify(
                    {
                        name: '@dexto/test-image-full',
                        version: '1.0.0',
                        type: 'module',
                    },
                    null,
                    2
                )
            );

            await writeFileEnsuringDir(
                path.join(tempDir, 'dexto.image.ts'),
                `import type { ImageDefinition } from '@dexto/image-bundler';

const image = {
    name: 'test-image-full',
    version: '1.0.0',
    description: 'Test image with tools/storage/hooks/compaction factories',
    target: 'local-development',
} satisfies ImageDefinition;

export default image;
`
            );

            await writeFileEnsuringDir(
                path.join(tempDir, 'tools', 'sample-tools', 'index.ts'),
                `const configSchema = {
    parse: (value: unknown) => value,
};

const inputSchema = {
    parse: (value: unknown) => value,
};

export const factory = {
    configSchema,
    create: (_config: unknown) => {
        return [
            {
                id: 'sample-echo',
                description: 'Echo tool (bundler integration test)',
                inputSchema,
                execute: async (input: unknown) => input,
            },
        ];
    },
};
`
            );

            await writeFileEnsuringDir(
                path.join(tempDir, 'hooks', 'sample-hook', 'index.ts'),
                `const configSchema = {
    parse: (value: unknown) => value,
};

export const factory = {
    configSchema,
    create: (_config: unknown) => {
        return {
            beforeResponse: async () => ({ ok: true }),
        };
    },
};
`
            );

            await writeFileEnsuringDir(
                path.join(tempDir, 'compaction', 'noop', 'index.ts'),
                `const configSchema = {
    parse: (value: unknown) => value,
};

export const factory = {
    configSchema,
    create: (_config: unknown) => ({}),
};
`
            );

            await writeFileEnsuringDir(
                path.join(tempDir, 'storage', 'blob', 'in-memory', 'index.ts'),
                `const configSchema = {
    parse: (value: unknown) => value,
};

export const factory = {
    configSchema,
    create: (_config: unknown, _logger: unknown) => ({}),
};
`
            );

            await writeFileEnsuringDir(
                path.join(tempDir, 'storage', 'database', 'in-memory', 'index.ts'),
                `const configSchema = {
    parse: (value: unknown) => value,
};

export const factory = {
    configSchema,
    create: (_config: unknown, _logger: unknown) => ({}),
};
`
            );

            await writeFileEnsuringDir(
                path.join(tempDir, 'storage', 'cache', 'in-memory', 'index.ts'),
                `const configSchema = {
    parse: (value: unknown) => value,
};

export const factory = {
    configSchema,
    create: (_config: unknown, _logger: unknown) => ({}),
};
`
            );

            const distDir = path.join(tempDir, 'dist');
            const result = await bundle({
                imagePath: path.join(tempDir, 'dexto.image.ts'),
                outDir: distDir,
            });

            const image = await loadImage(pathToFileURL(result.entryFile).href);
            expect(image.metadata.name).toBe('test-image-full');

            expect(image.tools['sample-tools']).toBeDefined();
            expect(image.hooks['sample-hook']).toBeDefined();
            expect(image.compaction['noop']).toBeDefined();

            expect(image.storage.blob['in-memory']).toBeDefined();
            expect(image.storage.database['in-memory']).toBeDefined();
            expect(image.storage.cache['in-memory']).toBeDefined();
        } finally {
            await rm(tempDir, { recursive: true, force: true });
            logSpy.mockRestore();
            warnSpy.mockRestore();
        }
    }, 20000);
});
