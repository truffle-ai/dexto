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
    Tool,
} from '@dexto/core';
import { vi } from 'vitest';

export function createMockLogger(): IDextoLogger {
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
    return logger;
}

export function createMockBlobStore(storeType: string): BlobStore {
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

export function createMockDatabase(storeType: string): Database {
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

export function createMockCache(storeType: string): Cache {
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

export function createMockTool(id: string): Tool {
    return {
        id,
        description: `tool:${id}`,
        inputSchema: z.object({}).strict(),
        execute: vi.fn(async () => ({ ok: true })),
    };
}
