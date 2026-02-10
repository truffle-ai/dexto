import type { Cache } from '../storage/cache/types.js';
import type { Database } from '../storage/database/types.js';
import type {
    BlobData,
    BlobInput,
    BlobMetadata,
    BlobReference,
    BlobStats,
    BlobStore,
    StoredBlobMetadata,
} from '../storage/blob/types.js';
import { StorageManager } from '../storage/storage-manager.js';
import type { IDextoLogger } from '../logger/v2/types.js';
import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';

type CacheEntry = {
    value: unknown;
    expiresAt?: number | undefined;
};

class InMemoryCache implements Cache {
    private connected = false;
    private entries = new Map<string, CacheEntry>();

    async connect(): Promise<void> {
        this.connected = true;
    }

    async disconnect(): Promise<void> {
        this.connected = false;
        this.entries.clear();
    }

    isConnected(): boolean {
        return this.connected;
    }

    getStoreType(): string {
        return 'in-memory';
    }

    async get<T>(key: string): Promise<T | undefined> {
        const entry = this.entries.get(key);
        if (!entry) return undefined;

        if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
            this.entries.delete(key);
            return undefined;
        }

        return entry.value as T;
    }

    async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
        const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;
        this.entries.set(key, { value, expiresAt });
    }

    async delete(key: string): Promise<void> {
        this.entries.delete(key);
    }
}

class InMemoryDatabase implements Database {
    private connected = false;
    private data = new Map<string, unknown>();

    async connect(): Promise<void> {
        this.connected = true;
    }

    async disconnect(): Promise<void> {
        this.connected = false;
        this.data.clear();
    }

    isConnected(): boolean {
        return this.connected;
    }

    getStoreType(): string {
        return 'in-memory';
    }

    async get<T>(key: string): Promise<T | undefined> {
        return this.data.get(key) as T | undefined;
    }

    async set<T>(key: string, value: T): Promise<void> {
        this.data.set(key, value);
    }

    async delete(key: string): Promise<void> {
        this.data.delete(key);
    }

    async list(prefix: string): Promise<string[]> {
        return Array.from(this.data.keys()).filter((key) => key.startsWith(prefix));
    }

    async append<T>(key: string, item: T): Promise<void> {
        const existing = this.data.get(key);
        const next = Array.isArray(existing) ? [...existing, item] : [item];
        this.data.set(key, next);
    }

    async getRange<T>(key: string, start: number, count: number): Promise<T[]> {
        const existing = this.data.get(key);
        if (!Array.isArray(existing)) return [];
        return (existing as T[]).slice(start, start + count);
    }
}

type StoredBlob = {
    data: Buffer;
    metadata: StoredBlobMetadata;
};

class InMemoryBlobStore implements BlobStore {
    private connected = false;
    private blobs = new Map<string, StoredBlob>();

    async connect(): Promise<void> {
        this.connected = true;
    }

    async disconnect(): Promise<void> {
        this.connected = false;
        this.blobs.clear();
    }

    isConnected(): boolean {
        return this.connected;
    }

    getStoreType(): string {
        return 'in-memory';
    }

    getStoragePath(): string | undefined {
        return undefined;
    }

    async store(input: BlobInput, metadata?: BlobMetadata): Promise<BlobReference> {
        const { buffer, derivedMimeType } = await coerceBlobInputToBuffer(input);
        const mimeType = metadata?.mimeType ?? derivedMimeType ?? 'application/octet-stream';

        const createdAt = metadata?.createdAt ?? new Date();
        const hash = createHash('sha256').update(buffer).digest('hex');
        const id = randomUUID();

        const storedMetadata: StoredBlobMetadata = {
            id,
            mimeType,
            originalName: metadata?.originalName,
            createdAt,
            size: buffer.length,
            hash,
            source: metadata?.source,
        };

        this.blobs.set(id, { data: buffer, metadata: storedMetadata });

        return {
            id,
            uri: `blob:${id}`,
            metadata: storedMetadata,
        };
    }

    async retrieve(
        reference: string,
        format?: 'base64' | 'buffer' | 'path' | 'stream' | 'url'
    ): Promise<BlobData> {
        const id = normalizeBlobId(reference);
        const stored = this.blobs.get(id);
        if (!stored) {
            throw new Error(`Blob not found: ${reference}`);
        }

        const effectiveFormat = format ?? 'buffer';
        switch (effectiveFormat) {
            case 'base64':
                return {
                    format: 'base64',
                    data: stored.data.toString('base64'),
                    metadata: stored.metadata,
                };
            case 'buffer':
                return { format: 'buffer', data: stored.data, metadata: stored.metadata };
            case 'stream':
                return {
                    format: 'stream',
                    data: Readable.from(stored.data),
                    metadata: stored.metadata,
                };
            case 'url':
                return {
                    format: 'url',
                    data: `data:${stored.metadata.mimeType};base64,${stored.data.toString('base64')}`,
                    metadata: stored.metadata,
                };
            case 'path': {
                const outPath = path.join(os.tmpdir(), `dexto-blob-${id}`);
                await fs.writeFile(outPath, stored.data);
                return { format: 'path', data: outPath, metadata: stored.metadata };
            }
        }
    }

    async exists(reference: string): Promise<boolean> {
        const id = normalizeBlobId(reference);
        return this.blobs.has(id);
    }

    async delete(reference: string): Promise<void> {
        const id = normalizeBlobId(reference);
        this.blobs.delete(id);
    }

    async cleanup(olderThan?: Date): Promise<number> {
        if (!olderThan) return 0;

        let deleted = 0;
        for (const [id, blob] of this.blobs.entries()) {
            if (blob.metadata.createdAt < olderThan) {
                this.blobs.delete(id);
                deleted += 1;
            }
        }

        return deleted;
    }

    async getStats(): Promise<BlobStats> {
        const sizes = Array.from(this.blobs.values()).map((b) => b.metadata.size);
        const totalSize = sizes.reduce((sum, size) => sum + size, 0);
        return {
            count: this.blobs.size,
            totalSize,
            backendType: this.getStoreType(),
            storePath: 'memory',
        };
    }

    async listBlobs(): Promise<BlobReference[]> {
        return Array.from(this.blobs.values()).map((blob) => ({
            id: blob.metadata.id,
            uri: `blob:${blob.metadata.id}`,
            metadata: blob.metadata,
        }));
    }
}

function normalizeBlobId(reference: string): string {
    return reference.startsWith('blob:') ? reference.slice('blob:'.length) : reference;
}

async function coerceBlobInputToBuffer(input: BlobInput): Promise<{
    buffer: Buffer;
    derivedMimeType?: string | undefined;
}> {
    if (Buffer.isBuffer(input)) {
        return { buffer: input };
    }

    if (input instanceof Uint8Array) {
        return { buffer: Buffer.from(input) };
    }

    if (input instanceof ArrayBuffer) {
        return { buffer: Buffer.from(new Uint8Array(input)) };
    }

    if (typeof input !== 'string') {
        return { buffer: Buffer.from(input as never) };
    }

    if (input.startsWith('data:')) {
        const comma = input.indexOf(',');
        if (comma === -1) {
            return { buffer: Buffer.from(input) };
        }

        const header = input.slice(0, comma);
        const data = input.slice(comma + 1);

        const mimeMatch = header.match(/^data:([^;]+);base64$/);
        const mimeType = mimeMatch?.[1];
        return { buffer: Buffer.from(data, 'base64'), derivedMimeType: mimeType };
    }

    try {
        return { buffer: await fs.readFile(input) };
    } catch {
        return { buffer: Buffer.from(input, 'base64') };
    }
}

export function createInMemoryCache(): Cache {
    return new InMemoryCache();
}

export function createInMemoryDatabase(): Database {
    return new InMemoryDatabase();
}

export function createInMemoryBlobStore(): BlobStore {
    return new InMemoryBlobStore();
}

export async function createInMemoryStorageManager(logger: IDextoLogger): Promise<StorageManager> {
    const manager = new StorageManager(
        {
            cache: createInMemoryCache(),
            database: createInMemoryDatabase(),
            blobStore: createInMemoryBlobStore(),
        },
        logger
    );
    await manager.connect();
    return manager;
}
