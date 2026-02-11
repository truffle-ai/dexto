import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadImage, setImageImporter } from './load-image.js';

type PlainObject = Record<string, unknown>;

function createValidImageCandidate(overrides?: Partial<PlainObject>): PlainObject {
    return {
        metadata: {
            name: 'stub-image',
            version: '0.0.0',
            description: 'stub',
        },
        tools: {
            'noop-tools': {
                configSchema: z.object({}).passthrough(),
                create: () => [],
            },
        },
        storage: {
            blob: {
                'in-memory': {
                    configSchema: z.any(),
                    create: () => ({}),
                },
            },
            database: {
                'in-memory': {
                    configSchema: z.any(),
                    create: () => ({}),
                },
            },
            cache: {
                'in-memory': {
                    configSchema: z.any(),
                    create: () => ({}),
                },
            },
        },
        plugins: {},
        compaction: {},
        logger: {
            configSchema: z.object({}).passthrough(),
            create: () => ({}),
        },
        ...(overrides ?? {}),
    };
}

describe('loadImage', () => {
    afterEach(() => {
        setImageImporter(undefined);
    });

    it('loads a valid DextoImageModule export', async () => {
        const image = await loadImage('./__fixtures__/valid-image.ts');
        expect(image.metadata.name).toBe('fixture-image');
    });

    it('supports modules exporting { image }', async () => {
        setImageImporter(async () => ({
            image: createValidImageCandidate({
                metadata: { name: 'named-export-image', version: '0.0.0', description: 'stub' },
            }),
        }));

        const image = await loadImage('named-export-stub');
        expect(image.metadata.name).toBe('named-export-image');
    });

    it('throws a clear error when import fails', async () => {
        await expect(loadImage('this-image-does-not-exist-123')).rejects.toThrow(
            "Failed to import image 'this-image-does-not-exist-123'"
        );
    });

    it('throws a clear error when tools is not an object', async () => {
        setImageImporter(async () => ({
            default: createValidImageCandidate({ tools: [] }),
        }));

        await expect(loadImage('invalid-tools-stub')).rejects.toThrow(
            "Invalid image 'invalid-tools-stub': expected 'tools' to be an object"
        );
    });

    it('throws a clear error when tool factories do not have a Zod configSchema', async () => {
        setImageImporter(async () => ({
            default: createValidImageCandidate({
                tools: {
                    broken: {
                        configSchema: {},
                        create: () => [],
                    },
                },
            }),
        }));

        await expect(loadImage('invalid-tool-schema-stub')).rejects.toThrow(
            "Invalid image 'invalid-tool-schema-stub': expected 'tools.broken.configSchema' to be a Zod schema"
        );
    });

    it('throws a clear error when logger.create is not a function', async () => {
        setImageImporter(async () => ({
            default: createValidImageCandidate({
                logger: {
                    configSchema: z.object({}).passthrough(),
                    create: 'not-a-function',
                },
            }),
        }));

        await expect(loadImage('invalid-logger-stub')).rejects.toThrow(
            "Invalid image 'invalid-logger-stub': logger.create must be a function"
        );
    });

    it('throws a clear error when the module export is not a DextoImageModule', async () => {
        await expect(loadImage('@dexto/core')).rejects.toThrow("Invalid image '@dexto/core':");
    });
});
