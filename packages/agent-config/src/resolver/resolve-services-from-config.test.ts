import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import type { Plugin } from '@dexto/core';
import type { DextoImageModule } from '../image/types.js';
import { AgentConfigSchema, type AgentConfig } from '../schemas/agent-config.js';
import { resolveServicesFromConfig } from './resolve-services-from-config.js';
import {
    createMockBlobStore,
    createMockCache,
    createMockDatabase,
    createMockLogger,
    createMockTool,
} from './__fixtures__/test-mocks.js';

describe('resolveServicesFromConfig', () => {
    const baseConfig: AgentConfig = {
        systemPrompt: 'You are a helpful assistant',
        llm: {
            provider: 'openai',
            model: 'gpt-4o-mini',
            apiKey: 'test-key',
        },
        storage: {
            cache: { type: 'in-memory' },
            database: { type: 'in-memory' },
            blob: { type: 'in-memory' },
        },
        compaction: { type: 'noop', enabled: false },
    };

    function createMockImage(overrides?: Partial<DextoImageModule>): DextoImageModule {
        const loggerFactory = {
            configSchema: z
                .object({
                    agentId: z.string(),
                    config: z.unknown(),
                })
                .strict(),
            create: (_cfg: { agentId: string }) => createMockLogger(),
        };

        const image: DextoImageModule = {
            metadata: { name: 'mock-image', version: '0.0.0', description: 'mock' },
            tools: {},
            storage: {
                blob: {
                    'in-memory': {
                        configSchema: z.any(),
                        create: () => createMockBlobStore('in-memory'),
                    },
                },
                database: {
                    'in-memory': {
                        configSchema: z.any(),
                        create: () => createMockDatabase('in-memory'),
                    },
                },
                cache: {
                    'in-memory': {
                        configSchema: z.any(),
                        create: () => createMockCache('in-memory'),
                    },
                },
            },
            plugins: {},
            compaction: {},
            logger: loggerFactory,
            ...(overrides ?? {}),
        };

        return image;
    }

    it('resolves storage + tools and skips tools with enabled:false', async () => {
        const fooFactoryCreate = vi.fn(() => [createMockTool('foo')]);
        const barFactoryCreate = vi.fn(() => [createMockTool('bar')]);

        const image = createMockImage({
            tools: {
                'foo-tools': {
                    configSchema: z
                        .object({ type: z.literal('foo-tools'), foo: z.number() })
                        .strict(),
                    create: fooFactoryCreate,
                },
                'bar-tools': {
                    configSchema: z.object({ type: z.literal('bar-tools') }).strict(),
                    create: barFactoryCreate,
                },
            },
        });

        const validated = AgentConfigSchema.parse({
            ...baseConfig,
            tools: [
                { type: 'foo-tools', foo: 123, enabled: true },
                { type: 'bar-tools', enabled: false },
            ],
        } satisfies AgentConfig);

        const services = await resolveServicesFromConfig(validated, image);

        expect(services.storage.blob.getStoreType()).toBe('in-memory');
        expect(services.storage.database.getStoreType()).toBe('in-memory');
        expect(services.storage.cache.getStoreType()).toBe('in-memory');

        expect(services.tools.map((t) => t.id)).toEqual(['custom--foo']);
        expect(fooFactoryCreate).toHaveBeenCalledTimes(1);
        expect(fooFactoryCreate).toHaveBeenCalledWith({ type: 'foo-tools', foo: 123 });
        expect(barFactoryCreate).not.toHaveBeenCalled();
    });

    it('uses image.defaults.tools when config.tools is omitted', async () => {
        const fooFactoryCreate = vi.fn(() => [createMockTool('foo')]);

        const image = createMockImage({
            defaults: {
                tools: [{ type: 'foo-tools', foo: 1 }],
            },
            tools: {
                'foo-tools': {
                    configSchema: z
                        .object({ type: z.literal('foo-tools'), foo: z.number() })
                        .strict(),
                    create: fooFactoryCreate,
                },
            },
        });

        const validated = AgentConfigSchema.parse(baseConfig);
        expect(validated.tools).toBeUndefined();

        const services = await resolveServicesFromConfig(validated, image);
        expect(services.tools.map((t) => t.id)).toEqual(['custom--foo']);
    });

    it('throws a clear error for unknown tool types', async () => {
        const image = createMockImage({
            tools: {
                'foo-tools': {
                    configSchema: z.object({ type: z.literal('foo-tools') }).strict(),
                    create: () => [createMockTool('foo')],
                },
            },
        });

        const validated = AgentConfigSchema.parse({
            ...baseConfig,
            tools: [{ type: 'unknown-tools' }],
        } satisfies AgentConfig);

        await expect(resolveServicesFromConfig(validated, image)).rejects.toThrow(
            "Unknown tool type 'unknown-tools'."
        );
    });

    it('throws a clear error for unknown storage types', async () => {
        const image = createMockImage();

        const validated = AgentConfigSchema.parse({
            ...baseConfig,
            storage: {
                cache: { type: 'in-memory' },
                database: { type: 'in-memory' },
                blob: { type: 'local', storePath: '/tmp/blobs' },
            },
        } satisfies AgentConfig);

        await expect(resolveServicesFromConfig(validated, image)).rejects.toThrow(
            "Unknown blob storage type 'local'."
        );
    });

    it('prefixes builtin tool ids as internal-- and preserves already-qualified ids', async () => {
        const builtinFactoryCreate = vi.fn(() => [
            createMockTool('ask_user'),
            createMockTool('internal--already-qualified'),
        ]);
        const customFactoryCreate = vi.fn(() => [
            createMockTool('custom--foo'),
            createMockTool('bar'),
        ]);

        const image = createMockImage({
            tools: {
                'builtin-tools': {
                    configSchema: z.object({ type: z.literal('builtin-tools') }).strict(),
                    create: builtinFactoryCreate,
                },
                'foo-tools': {
                    configSchema: z.object({ type: z.literal('foo-tools') }).strict(),
                    create: customFactoryCreate,
                },
            },
        });

        const validated = AgentConfigSchema.parse({
            ...baseConfig,
            tools: [{ type: 'builtin-tools' }, { type: 'foo-tools' }],
        } satisfies AgentConfig);

        const services = await resolveServicesFromConfig(validated, image);

        expect(services.tools.map((t) => t.id)).toEqual([
            'internal--ask_user',
            'internal--already-qualified',
            'custom--foo',
            'custom--bar',
        ]);
    });

    it('warns and skips duplicate tool ids across factories', async () => {
        const image = createMockImage({
            tools: {
                'foo-tools': {
                    configSchema: z.object({ type: z.literal('foo-tools') }).strict(),
                    create: () => [createMockTool('dup')],
                },
                'bar-tools': {
                    configSchema: z.object({ type: z.literal('bar-tools') }).strict(),
                    create: () => [createMockTool('dup')],
                },
            },
        });

        const validated = AgentConfigSchema.parse({
            ...baseConfig,
            tools: [{ type: 'foo-tools' }, { type: 'bar-tools' }],
        } satisfies AgentConfig);

        const services = await resolveServicesFromConfig(validated, image);

        expect(services.tools.map((t) => t.id)).toEqual(['custom--dup']);
        expect(services.logger.warn).toHaveBeenCalledWith(
            "Tool id conflict for 'custom--dup'. Skipping duplicate tool."
        );
    });

    it('treats config.tools as atomic (empty array overrides image.defaults.tools)', async () => {
        const fooFactoryCreate = vi.fn(() => [createMockTool('foo')]);

        const image = createMockImage({
            defaults: {
                tools: [{ type: 'foo-tools' }],
            },
            tools: {
                'foo-tools': {
                    configSchema: z.object({ type: z.literal('foo-tools') }).strict(),
                    create: fooFactoryCreate,
                },
            },
        });

        const validated = AgentConfigSchema.parse({
            ...baseConfig,
            tools: [],
        } satisfies AgentConfig);

        const services = await resolveServicesFromConfig(validated, image);
        expect(services.tools).toEqual([]);
        expect(fooFactoryCreate).not.toHaveBeenCalled();
    });

    it('throws when tool factory configSchema validation fails', async () => {
        const image = createMockImage({
            tools: {
                'foo-tools': {
                    configSchema: z
                        .object({ type: z.literal('foo-tools'), foo: z.number() })
                        .strict(),
                    create: () => [createMockTool('foo')],
                },
            },
        });

        const validated = AgentConfigSchema.parse({
            ...baseConfig,
            tools: [{ type: 'foo-tools', foo: 'not-a-number' }],
        } satisfies AgentConfig);

        await expect(resolveServicesFromConfig(validated, image)).rejects.toThrow(
            /Expected number/
        );
    });

    it('throws a clear error for unknown plugin types', async () => {
        const image = createMockImage({
            plugins: {
                'content-policy': {
                    configSchema: z.object({ type: z.literal('content-policy') }).strict(),
                    create: () => ({ beforeResponse: async () => ({ ok: true }) }),
                },
            },
        });

        const validated = AgentConfigSchema.parse({
            ...baseConfig,
            plugins: [{ type: 'content-policy' }, { type: 'response-sanitizer' }],
        } satisfies AgentConfig);

        await expect(resolveServicesFromConfig(validated, image)).rejects.toThrow(
            /Unknown plugin type 'response-sanitizer'/
        );
    });

    it('throws when plugin factory configSchema validation fails', async () => {
        const image = createMockImage({
            plugins: {
                'content-policy': {
                    configSchema: z
                        .object({ type: z.literal('content-policy'), foo: z.number() })
                        .strict(),
                    create: () => ({ beforeResponse: async () => ({ ok: true }) }),
                },
            },
        });

        const validated = AgentConfigSchema.parse({
            ...baseConfig,
            plugins: [{ type: 'content-policy', foo: 'not-a-number' }],
        } satisfies AgentConfig);

        await expect(resolveServicesFromConfig(validated, image)).rejects.toThrow(
            /Expected number/
        );
    });

    it('resolves plugins via image factories (list order) and runs initialize()', async () => {
        const initCalls: string[] = [];

        const createPlugin = (name: string): Plugin => ({
            initialize: async () => {
                initCalls.push(name);
            },
            beforeResponse: async () => ({ ok: true }),
        });

        const image = createMockImage({
            plugins: {
                'content-policy': {
                    configSchema: z.object({ type: z.literal('content-policy') }).strict(),
                    create: () => createPlugin('content-policy'),
                },
                'response-sanitizer': {
                    configSchema: z.object({ type: z.literal('response-sanitizer') }).strict(),
                    create: () => createPlugin('response-sanitizer'),
                },
            },
        });

        const validated = AgentConfigSchema.parse({
            ...baseConfig,
            plugins: [{ type: 'content-policy' }, { type: 'response-sanitizer' }],
        } satisfies AgentConfig);

        const services = await resolveServicesFromConfig(validated, image);
        expect(services.plugins).toHaveLength(2);
        expect(initCalls).toEqual(['content-policy', 'response-sanitizer']);
    });
});
