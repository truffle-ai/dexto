import { createHash } from 'crypto';
import { Readable } from 'stream';
import type { IDextoLogger } from '@dexto/core';
import { DextoLogComponent, StorageError } from '@dexto/core';
import type {
    BlobStore,
    BlobInput,
    BlobMetadata,
    BlobReference,
    BlobData,
    BlobStats,
    StoredBlobMetadata,
} from './types.js';
import { InMemoryBlobStoreSchema, type InMemoryBlobStoreConfig } from './schemas.js';
import type { InMemoryBlobStoreConfigInput } from './schemas.js';

/**
 * In-memory blob store implementation.
 *
 * Stores blobs in memory with content-based deduplication and size limits.
 * Suitable for development, testing, and scenarios where blob persistence
 * across restarts is not required.
 *
 * Features:
 * - Content-based deduplication (same as LocalBlobStore)
 * - Configurable size limits (per-blob and total)
 * - Automatic cleanup of old blobs
 * - MIME type detection
 * - Multi-format retrieval (base64, buffer, stream, data URI)
 *
 * Limitations:
 * - Data lost on restart (no persistence)
 * - Path format not supported (no filesystem)
 * - Memory usage proportional to blob size
 */
export class InMemoryBlobStore implements BlobStore {
    private config: InMemoryBlobStoreConfig;
    private blobs: Map<string, { data: Buffer; metadata: StoredBlobMetadata }> = new Map();
    private connected = false;
    private logger: IDextoLogger;

    constructor(config: InMemoryBlobStoreConfigInput, logger: IDextoLogger) {
        this.config = InMemoryBlobStoreSchema.parse(config);
        this.logger = logger.createChild(DextoLogComponent.STORAGE);
    }

    async connect(): Promise<void> {
        if (this.connected) return;
        this.connected = true;
        this.logger.debug('InMemoryBlobStore connected');
    }

    async disconnect(): Promise<void> {
        // Clear all blobs on disconnect
        this.blobs.clear();
        this.connected = false;
        this.logger.debug('InMemoryBlobStore disconnected');
    }

    isConnected(): boolean {
        return this.connected;
    }

    getStoreType(): string {
        return 'in-memory';
    }

    async store(input: BlobInput, metadata: BlobMetadata = {}): Promise<BlobReference> {
        if (!this.connected) {
            throw StorageError.blobBackendNotConnected('in-memory');
        }

        // Convert input to buffer for processing
        const buffer = await this.inputToBuffer(input);

        // Check per-blob size limit
        if (buffer.length > this.config.maxBlobSize) {
            throw StorageError.blobSizeExceeded(buffer.length, this.config.maxBlobSize);
        }

        // Generate content-based hash for deduplication
        const hash = createHash('sha256').update(buffer).digest('hex').substring(0, 16);
        const id = hash;

        // Check if blob already exists (deduplication)
        const existing = this.blobs.get(id);
        if (existing) {
            this.logger.debug(
                `Blob ${id} already exists, returning existing reference (deduplication)`
            );
            return {
                id,
                uri: `blob:${id}`,
                metadata: existing.metadata,
            };
        }

        // Check total storage size (only for new blobs)
        const currentSize = this.getTotalSize();
        if (currentSize + buffer.length > this.config.maxTotalSize) {
            throw StorageError.blobTotalSizeExceeded(
                currentSize + buffer.length,
                this.config.maxTotalSize
            );
        }

        // Create complete metadata
        const storedMetadata: StoredBlobMetadata = {
            id,
            mimeType: metadata.mimeType || this.detectMimeType(buffer, metadata.originalName),
            originalName: metadata.originalName,
            createdAt: metadata.createdAt || new Date(),
            source: metadata.source || 'system',
            size: buffer.length,
            hash,
        };

        // Store blob in memory
        this.blobs.set(id, { data: buffer, metadata: storedMetadata });

        this.logger.debug(`Stored blob ${id} (${buffer.length} bytes, ${storedMetadata.mimeType})`);

        return {
            id,
            uri: `blob:${id}`,
            metadata: storedMetadata,
        };
    }

    async retrieve(
        reference: string,
        format: 'base64' | 'buffer' | 'path' | 'stream' | 'url' = 'base64'
    ): Promise<BlobData> {
        if (!this.connected) {
            throw StorageError.blobBackendNotConnected('in-memory');
        }

        const id = this.parseReference(reference);
        const blob = this.blobs.get(id);

        if (!blob) {
            throw StorageError.blobNotFound(reference);
        }

        // Return data in requested format
        switch (format) {
            case 'base64':
                return {
                    format: 'base64',
                    data: blob.data.toString('base64'),
                    metadata: blob.metadata,
                };

            case 'buffer':
                return {
                    format: 'buffer',
                    data: Buffer.from(blob.data),
                    metadata: { ...blob.metadata },
                };

            case 'path':
                // Path format not supported for in-memory blobs
                throw new Error(
                    'Path format not supported for in-memory blobs. Use local blob storage for filesystem paths.'
                );

            case 'stream': {
                // Create readable stream from buffer
                const stream = Readable.from(blob.data);
                return {
                    format: 'stream',
                    data: stream as NodeJS.ReadableStream,
                    metadata: blob.metadata,
                };
            }

            case 'url': {
                // Return data URI for in-memory blobs
                const base64 = blob.data.toString('base64');
                const mimeType = blob.metadata.mimeType || 'application/octet-stream';
                const dataUrl = `data:${mimeType};base64,${base64}`;
                return {
                    format: 'url',
                    data: dataUrl,
                    metadata: blob.metadata,
                };
            }

            default:
                throw StorageError.blobInvalidInput(format, `Unsupported format: ${format}`);
        }
    }

    async exists(reference: string): Promise<boolean> {
        if (!this.connected) {
            throw StorageError.blobBackendNotConnected('in-memory');
        }

        const id = this.parseReference(reference);
        return this.blobs.has(id);
    }

    async delete(reference: string): Promise<void> {
        if (!this.connected) {
            throw StorageError.blobBackendNotConnected('in-memory');
        }

        const id = this.parseReference(reference);

        if (!this.blobs.has(id)) {
            throw StorageError.blobNotFound(reference);
        }

        this.blobs.delete(id);
        this.logger.debug(`Deleted blob: ${id}`);
    }

    async cleanup(olderThan?: Date): Promise<number> {
        if (!this.connected) {
            throw StorageError.blobBackendNotConnected('in-memory');
        }

        // Default cutoff: clean up blobs older than 30 days
        const cutoffDate = olderThan || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        let deletedCount = 0;

        for (const [id, { metadata }] of this.blobs.entries()) {
            if (metadata.createdAt < cutoffDate) {
                this.blobs.delete(id);
                deletedCount++;
                this.logger.debug(`Cleaned up old blob: ${id}`);
            }
        }

        if (deletedCount > 0) {
            this.logger.info(`Blob cleanup: removed ${deletedCount} old blobs from memory`);
        }

        return deletedCount;
    }

    async getStats(): Promise<BlobStats> {
        if (!this.connected) {
            throw StorageError.blobBackendNotConnected('in-memory');
        }

        // Stats are computed instantly from Map (no caching needed)
        return {
            count: this.blobs.size,
            totalSize: this.getTotalSize(),
            backendType: 'in-memory',
            storePath: 'memory://',
        };
    }

    async listBlobs(): Promise<BlobReference[]> {
        if (!this.connected) {
            throw StorageError.blobBackendNotConnected('in-memory');
        }

        return Array.from(this.blobs.entries()).map(([id, { metadata }]) => ({
            id,
            uri: `blob:${id}`,
            metadata,
        }));
    }

    getStoragePath(): string | undefined {
        // In-memory store has no filesystem path
        return undefined;
    }

    /**
     * Calculate total size of all blobs in memory
     */
    private getTotalSize(): number {
        return Array.from(this.blobs.values()).reduce((sum, { data }) => sum + data.length, 0);
    }

    /**
     * Convert various input types to Buffer.
     * Copied from LocalBlobStore with minor adaptations.
     */
    private async inputToBuffer(input: BlobInput): Promise<Buffer> {
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
            // Handle data URI
            if (input.startsWith('data:')) {
                const commaIndex = input.indexOf(',');
                if (commaIndex !== -1 && input.includes(';base64,')) {
                    const base64Data = input.substring(commaIndex + 1);
                    return Buffer.from(base64Data, 'base64');
                }
                throw StorageError.blobEncodingError(
                    'inputToBuffer',
                    'Unsupported data URI format'
                );
            }

            // For in-memory store, we don't read from filesystem paths
            // Assume base64 string
            try {
                return Buffer.from(input, 'base64');
            } catch {
                throw StorageError.blobEncodingError('inputToBuffer', 'Invalid base64 string');
            }
        }

        throw StorageError.blobInvalidInput(input, `Unsupported input type: ${typeof input}`);
    }

    /**
     * Parse blob reference to extract ID.
     * Copied from LocalBlobStore.
     */
    private parseReference(reference: string): string {
        if (!reference) {
            throw StorageError.blobInvalidReference(reference, 'Empty reference');
        }

        if (reference.startsWith('blob:')) {
            const id = reference.substring(5);
            if (!id) {
                throw StorageError.blobInvalidReference(reference, 'Empty blob ID after prefix');
            }
            return id;
        }

        return reference;
    }

    /**
     * Detect MIME type from buffer content and/or filename.
     * Copied from LocalBlobStore.
     */
    private detectMimeType(buffer: Buffer, filename?: string): string {
        // Basic magic number detection
        const header = buffer.subarray(0, 16);

        // Check common file signatures
        if (header.length >= 3) {
            const jpegSignature = header.subarray(0, 3);
            if (jpegSignature.equals(Buffer.from([0xff, 0xd8, 0xff]))) {
                return 'image/jpeg';
            }
        }

        if (header.length >= 4) {
            const signature = header.subarray(0, 4);
            if (signature.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'image/png';
            if (signature.equals(Buffer.from([0x47, 0x49, 0x46, 0x38]))) return 'image/gif';
            if (signature.equals(Buffer.from([0x25, 0x50, 0x44, 0x46]))) return 'application/pdf';
        }

        // Try filename extension
        if (filename) {
            const ext = filename.split('.').pop()?.toLowerCase();
            const mimeTypes: Record<string, string> = {
                jpg: 'image/jpeg',
                jpeg: 'image/jpeg',
                png: 'image/png',
                gif: 'image/gif',
                pdf: 'application/pdf',
                txt: 'text/plain',
                json: 'application/json',
                xml: 'text/xml',
                html: 'text/html',
                css: 'text/css',
                js: 'text/javascript',
                md: 'text/markdown',
                mp3: 'audio/mpeg',
                mp4: 'video/mp4',
                wav: 'audio/wav',
            };
            if (ext && mimeTypes[ext]) return mimeTypes[ext];
        }

        // Check if content looks like text
        if (this.isTextBuffer(buffer)) {
            return 'text/plain';
        }

        return 'application/octet-stream';
    }

    /**
     * Check if buffer contains text content.
     * Copied from LocalBlobStore.
     */
    private isTextBuffer(buffer: Buffer): boolean {
        // Simple heuristic: check if most bytes are printable ASCII or common UTF-8
        let printableCount = 0;
        const sampleSize = Math.min(512, buffer.length);

        for (let i = 0; i < sampleSize; i++) {
            const byte = buffer[i];
            if (
                byte !== undefined &&
                ((byte >= 32 && byte <= 126) || byte === 9 || byte === 10 || byte === 13)
            ) {
                printableCount++;
            }
        }

        return printableCount / sampleSize > 0.7;
    }
}
