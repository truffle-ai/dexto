import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import type {
    BlobStore,
    BlobReference,
    StoredBlobMetadata,
    BlobData,
    BlobStats,
    Cache,
    Database,
    IDextoLogger,
    InternalTool,
    DextoPlugin,
} from '@dexto/core';
import type { DextoImageModule } from '../image/types.js';
import { AgentConfigSchema, type AgentConfig } from '../schemas/agent-config.js';
import { resolveServicesFromConfig } from './resolve-services-from-config.js';

function createMockLogger(agentId: string): IDextoLogger {
    const logger: IDextoLogger = {
        debug: vi.fn(),
        silly: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        trackException: vi.fn(),
        createChild: () => logger,
        setLevel: vi.fn(),
        getLevel: () => 'info',
        getLogFilePath: () => null,
        destroy: vi.fn(async () => {}),
    };
    logger.info(`mock logger created`, { agentId });
    return logger;
}

function createMockBlobStore(storeType: string): BlobStore {
    const metadata: StoredBlobMetadata = {
        id: 'blob-1',
        mimeType: 'text/plain',
        createdAt: new Date(0),
        size: 0,
        hash: 'hash',
    };
    const ref: BlobReference = { id: metadata.id, uri: `blob:${metadata.id}`, metadata };
    const data: BlobData = { format: 'base64', data: '', metadata };
    const stats: BlobStats = { count: 0, totalSize: 0, backendType: storeType, storePath: '' };

    return {
        store: vi.fn(async () => ref),
        retrieve: vi.fn(async () => data),
        exists: vi.fn(async () => false),
        delete: vi.fn(async () => {}),
        cleanup: vi.fn(async () => 0),
        getStats: vi.fn(async () => stats),
        listBlobs: vi.fn(async () => []),
        getStoragePath: () => undefined,
        connect: vi.fn(async () => {}),
        disconnect: vi.fn(async () => {}),
        isConnected: () => true,
        getStoreType: () => storeType,
    };
}

function createMockDatabase(storeType: string): Database {
    return {
        get: vi.fn(async () => undefined),
        set: vi.fn(async () => {}),
        delete: vi.fn(async () => {}),
        list: vi.fn(async () => []),
        append: vi.fn(async () => {}),
        getRange: vi.fn(async () => []),
        connect: vi.fn(async () => {}),
        disconnect: vi.fn(async () => {}),
        isConnected: () => true,
        getStoreType: () => storeType,
    };
}

function createMockCache(storeType: string): Cache {
    return {
        get: vi.fn(async () => undefined),
        set: vi.fn(async () => {}),
        delete: vi.fn(async () => {}),
        connect: vi.fn(async () => {}),
        disconnect: vi.fn(async () => {}),
        isConnected: () => true,
        getStoreType: () => storeType,
    };
}

function createMockTool(id: string): InternalTool {
    return {
        id,
        description: `tool:${id}`,
        inputSchema: z.object({}).strict(),
        execute: vi.fn(async () => ({ ok: true })),
    };
}

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
            create: (cfg: { agentId: string }) => createMockLogger(cfg.agentId),
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

    it('resolves built-in plugins via image factories (sorted by priority) and runs initialize()', async () => {
        const initCalls: string[] = [];

        const createPlugin = (name: string): DextoPlugin => ({
            initialize: async () => {
                initCalls.push(name);
            },
            beforeResponse: async () => ({ ok: true }),
        });

        const image = createMockImage({
            plugins: {
                'content-policy': {
                    configSchema: z.object({ priority: z.number().int() }).passthrough(),
                    create: () => createPlugin('content-policy'),
                },
                'response-sanitizer': {
                    configSchema: z.object({ priority: z.number().int() }).passthrough(),
                    create: () => createPlugin('response-sanitizer'),
                },
            },
        });

        const validated = AgentConfigSchema.parse({
            ...baseConfig,
            plugins: {
                contentPolicy: { priority: 10, enabled: true },
                responseSanitizer: { priority: 5, enabled: true },
            },
        } satisfies AgentConfig);

        const services = await resolveServicesFromConfig(validated, image);
        expect(services.plugins).toHaveLength(2);
        expect(initCalls).toEqual(['response-sanitizer', 'content-policy']);
    });
});
