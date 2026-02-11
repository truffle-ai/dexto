import { describe, expect, it, vi } from 'vitest';
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
} from '@dexto/core';
import { AgentConfigSchema } from '../schemas/agent-config.js';
import type { ResolvedServices } from './types.js';
import { toDextoAgentOptions } from './to-dexto-agent-options.js';

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

describe('toDextoAgentOptions', () => {
    it('combines validated config + resolved services into DextoAgentOptions', () => {
        const validated = AgentConfigSchema.parse({
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
        });

        const logger = createMockLogger(validated.agentId);
        const services: ResolvedServices = {
            logger,
            storage: {
                blob: createMockBlobStore('in-memory'),
                database: createMockDatabase('in-memory'),
                cache: createMockCache('in-memory'),
            },
            tools: [createMockTool('foo')],
            plugins: [],
            compaction: null,
        };

        const options = toDextoAgentOptions({
            config: validated,
            services,
            overrides: {},
        });

        expect(options.agentId).toBe(validated.agentId);
        expect(options.llm).toBe(validated.llm);
        expect(options.systemPrompt).toBe(validated.systemPrompt);
        expect(options.mcpServers).toBe(validated.mcpServers);
        expect(options.sessions).toBe(validated.sessions);
        expect(options.toolConfirmation).toBe(validated.toolConfirmation);
        expect(options.elicitation).toBe(validated.elicitation);
        expect(options.internalResources).toBe(validated.internalResources);
        expect(options.prompts).toBe(validated.prompts);
        expect(options.overrides).toEqual({});

        expect(options.logger).toBe(logger);
        expect(options.storage.blob.getStoreType()).toBe('in-memory');
        expect(options.tools.map((t) => t.id)).toEqual(['foo']);
        expect(options.plugins).toEqual([]);
        expect(options.compaction).toBeNull();
    });
});
