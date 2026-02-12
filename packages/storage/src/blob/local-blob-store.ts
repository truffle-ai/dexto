import { promises as fs, createReadStream } from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { pathToFileURL } from 'url';
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
import type { LocalBlobStoreConfig } from './schemas.js';

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStoredBlobMetadata(value: unknown): StoredBlobMetadata {
    if (!isPlainObject(value)) {
        throw new Error('Invalid blob metadata: expected object');
    }

    const id = value['id'];
    if (typeof id !== 'string') {
        throw new Error('Invalid blob metadata: id');
    }

    const mimeType = value['mimeType'];
    if (typeof mimeType !== 'string') {
        throw new Error('Invalid blob metadata: mimeType');
    }

    const originalName = value['originalName'];
    if (originalName !== undefined && typeof originalName !== 'string') {
        throw new Error('Invalid blob metadata: originalName');
    }

    const createdAtRaw = value['createdAt'];
    const createdAt =
        createdAtRaw instanceof Date
            ? createdAtRaw
            : typeof createdAtRaw === 'string' || typeof createdAtRaw === 'number'
              ? new Date(createdAtRaw)
              : null;

    if (!createdAt || Number.isNaN(createdAt.getTime())) {
        throw new Error('Invalid blob metadata: createdAt');
    }

    const size = value['size'];
    if (typeof size !== 'number') {
        throw new Error('Invalid blob metadata: size');
    }

    const hash = value['hash'];
    if (typeof hash !== 'string') {
        throw new Error('Invalid blob metadata: hash');
    }

    const source = value['source'];
    if (source !== undefined && source !== 'tool' && source !== 'user' && source !== 'system') {
        throw new Error('Invalid blob metadata: source');
    }

    return {
        id,
        mimeType,
        ...(originalName !== undefined && { originalName }),
        createdAt,
        size,
        hash,
        ...(source !== undefined && { source }),
    };
}

/**
 * Local filesystem blob store implementation.
 *
 * Stores blobs on the local filesystem with content-based deduplication
 * and metadata tracking. This is the default store for development
 * and single-machine deployments.
 */
export class LocalBlobStore implements BlobStore {
    private config: LocalBlobStoreConfig;
    private storePath: string;
    private connected = false;
    private statsCache: { count: number; totalSize: number } | null = null;
    private statsCachePromise: Promise<void> | null = null;
    private lastStatsRefresh: number = 0;
    private logger: IDextoLogger;

    private static readonly STATS_REFRESH_INTERVAL_MS = 60000; // 1 minute

    constructor(config: LocalBlobStoreConfig, logger: IDextoLogger) {
        this.config = config;
        // Store path is provided via CLI enrichment
        this.storePath = config.storePath;
        this.logger = logger.createChild(DextoLogComponent.STORAGE);
    }

    async connect(): Promise<void> {
        if (this.connected) return;

        try {
            await fs.mkdir(this.storePath, { recursive: true });
            await this.refreshStatsCache();
            this.lastStatsRefresh = Date.now();
            this.connected = true;
            this.logger.debug(`LocalBlobStore connected at: ${this.storePath}`);

            // TODO: Implement automatic blob cleanup scheduling
            // - Call cleanup() on connect to remove old blobs based on cleanupAfterDays config
            // - Start a background interval task (e.g., daily) to periodically run cleanup()
            // - Ensure the background task can be cancelled on disconnect()
            // - Use the configured cleanupAfterDays value when invoking cleanup()
        } catch (error) {
            throw StorageError.blobOperationFailed('connect', 'local', error);
        }
    }

    async disconnect(): Promise<void> {
        this.connected = false;
        this.logger.debug('LocalBlobStore disconnected');
    }

    isConnected(): boolean {
        return this.connected;
    }

    getStoreType(): string {
        return 'local';
    }

    async store(input: BlobInput, metadata: BlobMetadata = {}): Promise<BlobReference> {
        if (!this.connected) {
            throw StorageError.blobBackendNotConnected('local');
        }

        // Convert input to buffer for processing
        const buffer = await this.inputToBuffer(input);

        // Check size limits
        if (buffer.length > this.config.maxBlobSize) {
            throw StorageError.blobSizeExceeded(buffer.length, this.config.maxBlobSize);
        }

        // Generate content-based hash for deduplication
        const hash = createHash('sha256').update(buffer).digest('hex').substring(0, 16);
        const id = hash;

        const blobPath = path.join(this.storePath, `${id}.dat`);
        const metaPath = path.join(this.storePath, `${id}.meta.json`);

        // Check if blob already exists (deduplication)
        try {
            const existingMeta = await fs.readFile(metaPath, 'utf-8');
            const parsed = JSON.parse(existingMeta) as unknown;
            const existingMetadata = parseStoredBlobMetadata(parsed);
            this.logger.debug(
                `Blob ${id} already exists, returning existing reference (deduplication)`
            );

            return {
                id,
                uri: `blob:${id}`,
                metadata: existingMetadata,
            };
        } catch {
            // Blob doesn't exist, continue with storage
        }

        // Check total storage size if configured (only for new blobs)
        const maxTotalSize = this.config.maxTotalSize;
        if (maxTotalSize) {
            const stats = await this.ensureStatsCache();
            if (stats.totalSize + buffer.length > maxTotalSize) {
                throw StorageError.blobTotalSizeExceeded(
                    stats.totalSize + buffer.length,
                    maxTotalSize
                );
            }
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

        try {
            // Store blob data and metadata atomically
            await Promise.all([
                fs.writeFile(blobPath, buffer),
                fs.writeFile(metaPath, JSON.stringify(storedMetadata, null, 2)),
            ]);

            this.logger.debug(
                `Stored blob ${id} (${buffer.length} bytes, ${storedMetadata.mimeType})`
            );

            this.updateStatsCacheAfterStore(buffer.length);

            return {
                id,
                uri: `blob:${id}`,
                metadata: storedMetadata,
            };
        } catch (error) {
            // Cleanup on failure
            await Promise.allSettled([
                fs.unlink(blobPath).catch(() => {}),
                fs.unlink(metaPath).catch(() => {}),
            ]);
            throw StorageError.blobOperationFailed('store', 'local', error);
        }
    }

    async retrieve(
        reference: string,
        format: 'base64' | 'buffer' | 'path' | 'stream' | 'url' = 'buffer'
    ): Promise<BlobData> {
        if (!this.connected) {
            throw StorageError.blobBackendNotConnected('local');
        }

        const id = this.parseReference(reference);
        const blobPath = path.join(this.storePath, `${id}.dat`);
        const metaPath = path.join(this.storePath, `${id}.meta.json`);

        try {
            // Load metadata
            const metaContent = await fs.readFile(metaPath, 'utf-8');
            const parsed = JSON.parse(metaContent) as unknown;
            const metadata = parseStoredBlobMetadata(parsed);

            // Return data in requested format
            switch (format) {
                case 'base64': {
                    const buffer = await fs.readFile(blobPath);
                    return { format: 'base64', data: buffer.toString('base64'), metadata };
                }
                case 'buffer': {
                    const buffer = await fs.readFile(blobPath);
                    return { format: 'buffer', data: buffer, metadata };
                }
                case 'path': {
                    // Verify file exists
                    await fs.access(blobPath);
                    return { format: 'path', data: blobPath, metadata };
                }
                case 'stream': {
                    const stream = createReadStream(blobPath);
                    return { format: 'stream', data: stream, metadata };
                }
                case 'url': {
                    // For local store, return file:// URL (cross-platform)
                    const absolutePath = path.resolve(blobPath);
                    return {
                        format: 'url',
                        data: pathToFileURL(absolutePath).toString(),
                        metadata,
                    };
                }
                default:
                    throw StorageError.blobInvalidInput(format, `Unsupported format: ${format}`);
            }
        } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
                throw StorageError.blobNotFound(reference);
            }
            throw StorageError.blobOperationFailed('retrieve', 'local', error);
        }
    }

    async exists(reference: string): Promise<boolean> {
        if (!this.connected) {
            throw StorageError.blobBackendNotConnected('local');
        }

        const id = this.parseReference(reference);
        const blobPath = path.join(this.storePath, `${id}.dat`);
        const metaPath = path.join(this.storePath, `${id}.meta.json`);

        try {
            await Promise.all([fs.access(blobPath), fs.access(metaPath)]);
            return true;
        } catch {
            return false;
        }
    }

    async delete(reference: string): Promise<void> {
        if (!this.connected) {
            throw StorageError.blobBackendNotConnected('local');
        }

        const id = this.parseReference(reference);
        const blobPath = path.join(this.storePath, `${id}.dat`);
        const metaPath = path.join(this.storePath, `${id}.meta.json`);

        try {
            const metaContent = await fs.readFile(metaPath, 'utf-8');
            const parsed = JSON.parse(metaContent) as unknown;
            const metadata = parseStoredBlobMetadata(parsed);
            await Promise.all([fs.unlink(blobPath), fs.unlink(metaPath)]);
            this.logger.debug(`Deleted blob: ${id}`);
            this.updateStatsCacheAfterDelete(metadata.size);
        } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
                throw StorageError.blobNotFound(reference);
            }
            throw StorageError.blobOperationFailed('delete', 'local', error);
        }
    }

    async cleanup(olderThan?: Date): Promise<number> {
        if (!this.connected) {
            throw StorageError.blobBackendNotConnected('local');
        }

        const cleanupDays = this.config.cleanupAfterDays;
        const cutoffDate = olderThan || new Date(Date.now() - cleanupDays * 24 * 60 * 60 * 1000);
        let deletedCount = 0;

        try {
            const files = await fs.readdir(this.storePath);
            const metaFiles = files.filter((f) => f.endsWith('.meta.json'));

            for (const metaFile of metaFiles) {
                const metaPath = path.join(this.storePath, metaFile);
                const id = metaFile.replace('.meta.json', '');
                const blobPath = path.join(this.storePath, `${id}.dat`);

                try {
                    const metaContent = await fs.readFile(metaPath, 'utf-8');
                    const parsed = JSON.parse(metaContent) as unknown;
                    const metadata = parseStoredBlobMetadata(parsed);

                    if (metadata.createdAt < cutoffDate) {
                        await Promise.all([
                            fs.unlink(blobPath).catch(() => {}),
                            fs.unlink(metaPath).catch(() => {}),
                        ]);
                        deletedCount++;
                        this.updateStatsCacheAfterDelete(metadata.size);
                        this.logger.debug(`Cleaned up old blob: ${id}`);
                    }
                } catch (error) {
                    this.logger.warn(
                        `Failed to process blob metadata ${metaFile}: ${String(error)}`
                    );
                }
            }

            if (deletedCount > 0) {
                this.logger.info(`Blob cleanup: removed ${deletedCount} old blobs`);
            }

            return deletedCount;
        } catch (error) {
            throw StorageError.blobCleanupFailed('local', error);
        }
    }

    async getStats(): Promise<BlobStats> {
        if (!this.connected) {
            throw StorageError.blobBackendNotConnected('local');
        }

        const stats = await this.ensureStatsCache();

        return {
            count: stats.count,
            totalSize: stats.totalSize,
            backendType: 'local',
            storePath: this.storePath,
        };
    }

    getStoragePath(): string | undefined {
        return this.storePath;
    }

    async listBlobs(): Promise<BlobReference[]> {
        if (!this.connected) {
            throw StorageError.blobBackendNotConnected('local');
        }

        try {
            const files = await fs.readdir(this.storePath);
            const metaFiles = files.filter((f) => f.endsWith('.meta.json'));
            const blobs: BlobReference[] = [];

            for (const metaFile of metaFiles) {
                try {
                    const metaPath = path.join(this.storePath, metaFile);
                    const metaContent = await fs.readFile(metaPath, 'utf-8');
                    const parsed = JSON.parse(metaContent) as unknown;
                    const metadata = parseStoredBlobMetadata(parsed);
                    const blobId = metaFile.replace('.meta.json', '');

                    blobs.push({
                        id: blobId,
                        uri: `blob:${blobId}`,
                        metadata,
                    });
                } catch (error) {
                    this.logger.warn(
                        `Failed to process blob metadata ${metaFile}: ${String(error)}`
                    );
                }
            }

            return blobs;
        } catch (error) {
            this.logger.warn(`Failed to list blobs: ${String(error)}`);
            return [];
        }
    }

    private async ensureStatsCache(): Promise<{ count: number; totalSize: number }> {
        const now = Date.now();
        const cacheAge = now - this.lastStatsRefresh;
        const isStale = cacheAge > LocalBlobStore.STATS_REFRESH_INTERVAL_MS;

        // Refresh if cache is missing OR stale
        if (!this.statsCache || isStale) {
            if (!this.statsCachePromise) {
                this.statsCachePromise = this.refreshStatsCache();
            }

            try {
                await this.statsCachePromise;
                this.lastStatsRefresh = now;
            } finally {
                this.statsCachePromise = null;
            }
        }

        return this.statsCache ?? { count: 0, totalSize: 0 };
    }

    private async refreshStatsCache(): Promise<void> {
        const stats = { count: 0, totalSize: 0 };
        try {
            const files = await fs.readdir(this.storePath);
            const datFiles = files.filter((f) => f.endsWith('.dat'));
            stats.count = datFiles.length;

            for (const datFile of datFiles) {
                try {
                    const stat = await fs.stat(path.join(this.storePath, datFile));
                    stats.totalSize += stat.size;
                } catch (error) {
                    this.logger.debug(
                        `Skipping size calculation for ${datFile}: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            }
        } catch (error) {
            this.logger.warn(`Failed to refresh blob stats cache: ${String(error)}`);
        }

        this.statsCache = stats;
    }

    private updateStatsCacheAfterStore(size: number): void {
        if (!this.statsCache) {
            this.statsCache = { count: 1, totalSize: size };
            return;
        }
        this.statsCache.count += 1;
        this.statsCache.totalSize += size;
    }

    private updateStatsCacheAfterDelete(size: number): void {
        if (!this.statsCache) {
            this.statsCache = { count: 0, totalSize: 0 };
            return;
        }
        this.statsCache.count = Math.max(0, this.statsCache.count - 1);
        this.statsCache.totalSize = Math.max(0, this.statsCache.totalSize - size);
    }

    /**
     * Convert various input types to Buffer
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

            // Handle file path - only if it looks like an actual file path
            if ((input.includes('/') || input.includes('\\')) && input.length > 1) {
                try {
                    await fs.access(input);
                    return await fs.readFile(input);
                } catch {
                    // If file doesn't exist, treat as base64
                }
            }

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
     * Parse blob reference to extract ID
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
     * Detect MIME type from buffer content and/or filename
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
            const ext = path.extname(filename).toLowerCase();
            const mimeTypes: Record<string, string> = {
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.png': 'image/png',
                '.gif': 'image/gif',
                '.pdf': 'application/pdf',
                '.txt': 'text/plain',
                '.json': 'application/json',
                '.xml': 'text/xml',
                '.html': 'text/html',
                '.css': 'text/css',
                '.js': 'text/javascript',
                '.mp3': 'audio/mpeg',
                '.mp4': 'video/mp4',
                '.wav': 'audio/wav',
            };
            if (mimeTypes[ext]) return mimeTypes[ext];
        }

        // Check if content looks like text
        if (this.isTextBuffer(buffer)) {
            return 'text/plain';
        }

        return 'application/octet-stream';
    }

    /**
     * Check if buffer contains text content
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
