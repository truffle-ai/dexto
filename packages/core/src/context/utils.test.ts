import { describe, expect, it } from 'vitest';
import type {
    BlobStore,
    BlobInput,
    BlobMetadata,
    BlobReference,
    BlobData,
    BlobStats,
    StoredBlobMetadata,
} from '../storage/blob/types.js';
import { normalizeToolResult, persistToolMedia } from './utils.js';

class FakeBlobStore implements BlobStore {
    private counter = 0;
    private connected = true;
    private readonly storage = new Map<string, Buffer>();
    private readonly metadata = new Map<string, StoredBlobMetadata>();

    async store(input: BlobInput, metadata: BlobMetadata = {}): Promise<BlobReference> {
        const buffer = this.toBuffer(input);
        const id = `fake-${this.counter++}`;
        const storedMetadata: StoredBlobMetadata = {
            id,
            mimeType: metadata.mimeType ?? 'application/octet-stream',
            originalName: metadata.originalName,
            createdAt: metadata.createdAt ?? new Date(),
            size: buffer.length,
            hash: id,
            source: metadata.source,
        };

        this.storage.set(id, buffer);
        this.metadata.set(id, storedMetadata);

        return {
            id,
            uri: `blob:${id}`,
            metadata: storedMetadata,
        };
    }

    async retrieve(
        _reference: string,
        _format?: 'base64' | 'buffer' | 'path' | 'stream' | 'url'
    ): Promise<BlobData> {
        throw new Error('Not implemented in FakeBlobStore');
    }

    async exists(reference: string): Promise<boolean> {
        return this.storage.has(this.parse(reference));
    }

    async delete(reference: string): Promise<void> {
        const id = this.parse(reference);
        this.storage.delete(id);
        this.metadata.delete(id);
    }

    async cleanup(_olderThan?: Date | undefined): Promise<number> {
        const count = this.storage.size;
        this.storage.clear();
        this.metadata.clear();
        return count;
    }

    async getStats(): Promise<BlobStats> {
        let totalSize = 0;
        for (const buffer of this.storage.values()) {
            totalSize += buffer.length;
        }
        return {
            count: this.storage.size,
            totalSize,
            backendType: 'fake',
            storePath: 'memory://fake',
        };
    }

    async listBlobs(): Promise<BlobReference[]> {
        return Array.from(this.metadata.values()).map((meta) => ({
            id: meta.id,
            uri: `blob:${meta.id}`,
            metadata: meta,
        }));
    }

    getStoragePath(): string | undefined {
        return undefined;
    }

    async connect(): Promise<void> {
        this.connected = true;
    }

    async disconnect(): Promise<void> {
        this.connected = false;
    }

    isConnected(): boolean {
        return this.connected;
    }

    getStoreType(): string {
        return 'fake';
    }

    private toBuffer(input: BlobInput): Buffer {
        if (Buffer.isBuffer(input)) {
            return input;
        }
        if (input instanceof Uint8Array) {
            return Buffer.from(input);
        }
        if (input instanceof ArrayBuffer) {
            return Buffer.from(new Uint8Array(input));
        }
        if (typeof input === 'string') {
            try {
                return Buffer.from(input, 'base64');
            } catch {
                return Buffer.from(input, 'utf-8');
            }
        }
        throw new Error('Unsupported blob input');
    }

    private parse(reference: string): string {
        return reference.startsWith('blob:') ? reference.slice(5) : reference;
    }
}

describe('tool result normalization pipeline', () => {
    it('normalizes data URI media into typed parts with inline media hints', async () => {
        const payload = Buffer.alloc(2048, 1);
        const dataUri = `data:image/png;base64,${payload.toString('base64')}`;

        const normalized = await normalizeToolResult(dataUri);

        expect(normalized.parts).toHaveLength(1);
        const part = normalized.parts[0];
        if (!part) {
            throw new Error('expected normalized image part');
        }
        expect(part.type).toBe('image');
        expect(normalized.inlineMedia).toHaveLength(1);
        const hint = normalized.inlineMedia[0];
        if (!hint) {
            throw new Error('expected inline media hint for data URI');
        }
        expect(hint.mimeType).toBe('image/png');
    });

    it('persists large inline media to the blob store and produces resource descriptors', async () => {
        const payload = Buffer.alloc(4096, 7);
        const dataUri = `data:image/jpeg;base64,${payload.toString('base64')}`;

        const normalized = await normalizeToolResult(dataUri);
        const store = new FakeBlobStore();

        const persisted = await persistToolMedia(normalized, {
            blobStore: store,
            toolName: 'image_tool',
            toolCallId: 'call-123',
        });

        expect(persisted.parts).toHaveLength(1);
        const part = persisted.parts[0];
        if (!part || part.type !== 'image') {
            throw new Error('expected image part after persistence');
        }
        expect(typeof part.image).toBe('string');
        expect(part.image).toMatch(/^@blob:/);
        expect(persisted.resources).toBeDefined();
        expect(persisted.resources?.[0]?.kind).toBe('image');
    });

    it('always persists video media regardless of payload size', async () => {
        const payload = Buffer.alloc(256, 3);
        const raw = [
            {
                type: 'file',
                data: payload.toString('base64'),
                mimeType: 'video/mp4',
                mediaKind: 'video' as const,
            },
        ];

        const normalized = await normalizeToolResult(raw);
        const hint = normalized.inlineMedia[0];
        if (!hint) {
            throw new Error('expected inline media hint for video payload');
        }
        expect(hint.mediaKind).toBe('video');

        const store = new FakeBlobStore();
        const persisted = await persistToolMedia(normalized, {
            blobStore: store,
            toolName: 'video_tool',
            toolCallId: 'call-456',
        });

        const filePart = persisted.parts[0];
        if (!filePart || filePart.type !== 'file') {
            throw new Error('expected file part after persistence');
        }
        expect(typeof filePart.data).toBe('string');
        expect(filePart.data).toMatch(/^@blob:/);
        expect(persisted.resources?.[0]?.kind).toBe('video');
    });
});
