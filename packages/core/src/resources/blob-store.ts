import { promises as fs } from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { logger } from '../logger/index.js';
import { getDextoPath } from '../utils/path.js';
import { ResourceError } from './errors.js';

/**
 * Input data for blob storage - supports various formats
 */
export type BlobInput =
    | string // base64, data URI, or file path
    | Uint8Array
    | Buffer
    | ArrayBuffer;

/**
 * Metadata associated with a stored blob
 */
export interface BlobMetadata {
    mimeType?: string | undefined;
    originalName?: string | undefined;
    createdAt?: Date | undefined;
    source?: 'tool' | 'user' | 'system' | undefined;
    size?: number | undefined;
}

/**
 * Complete blob information including stored metadata
 */
export interface StoredBlobMetadata {
    id: string;
    mimeType: string;
    originalName?: string | undefined;
    createdAt: Date;
    size: number;
    hash: string;
    source?: 'tool' | 'user' | 'system' | undefined;
}

/**
 * Reference to a stored blob
 */
export interface BlobReference {
    id: string;
    uri: string; // blob:id format for ResourceManager
    metadata: StoredBlobMetadata;
}

/**
 * Retrieved blob data in requested format
 */
export type BlobData =
    | { format: 'base64'; data: string; metadata: StoredBlobMetadata }
    | { format: 'buffer'; data: Buffer; metadata: StoredBlobMetadata }
    | { format: 'path'; data: string; metadata: StoredBlobMetadata };

/**
 * Configuration for blob store
 */
export interface BlobStoreConfig {
    maxBlobSize?: number | undefined; // Max size per blob in bytes
    maxTotalSize?: number | undefined; // Max total store size in bytes
    cleanupAfterDays?: number | undefined; // Auto-cleanup blobs older than N days
    storePath?: string | undefined; // Custom storage path (defaults to context-aware path)
}

/**
 * Core blob storage service that handles storing and retrieving binary data
 * with content-based deduplication and metadata tracking.
 */
export class BlobStore {
    private config: Required<BlobStoreConfig>;
    private storePath: string;
    private initialized = false;

    private static readonly DEFAULT_CONFIG = {
        maxBlobSize: 50 * 1024 * 1024, // 50MB
        maxTotalSize: 1024 * 1024 * 1024, // 1GB
        cleanupAfterDays: 30,
        storePath: '', // Will be set in constructor
    } as const;

    constructor(config: BlobStoreConfig = {}) {
        this.config = {
            ...BlobStore.DEFAULT_CONFIG,
            ...config,
            storePath: config.storePath || getDextoPath('data', 'blobs'),
        };
        this.storePath = this.config.storePath || getDextoPath('data', 'blobs');
    }

    /**
     * Initialize the blob store - create directory structure if needed
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            await fs.mkdir(this.storePath, { recursive: true });
            this.initialized = true;
            logger.debug(`BlobStore initialized at: ${this.storePath}`);
        } catch (error) {
            throw ResourceError.providerError('BlobStore', 'initialize', error);
        }
    }

    /**
     * Store blob data and return a reference
     */
    async store(input: BlobInput, metadata: BlobMetadata = {}): Promise<BlobReference> {
        await this.initialize();

        // Convert input to buffer for processing
        const buffer = await this.inputToBuffer(input);

        const maxSize = this.config.maxBlobSize || BlobStore.DEFAULT_CONFIG.maxBlobSize;
        if (buffer.length > maxSize) {
            throw ResourceError.providerError(
                'BlobStore',
                'store',
                `Blob size ${buffer.length} exceeds maximum ${maxSize} bytes`
            );
        }

        // Generate content-based hash for deduplication
        const hash = createHash('sha256').update(buffer).digest('hex').substring(0, 16);
        const id = hash;

        const blobPath = path.join(this.storePath, `${id}.dat`);
        const metaPath = path.join(this.storePath, `${id}.meta.json`);

        // Check if blob already exists (deduplication)
        try {
            const existingMeta = await fs.readFile(metaPath, 'utf-8');
            const existingMetadata: StoredBlobMetadata = JSON.parse(existingMeta);
            logger.debug(`Blob ${id} already exists, returning existing reference`);

            return {
                id,
                uri: `blob:${id}`,
                metadata: existingMetadata,
            };
        } catch {
            // Blob doesn't exist, continue with storage
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

            logger.debug(`Stored blob ${id} (${buffer.length} bytes, ${storedMetadata.mimeType})`);

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
            throw ResourceError.providerError('BlobStore', 'store', error);
        }
    }

    /**
     * Retrieve blob data in specified format
     */
    async retrieve(
        reference: string,
        format: 'base64' | 'buffer' | 'path' = 'buffer'
    ): Promise<BlobData> {
        await this.initialize();

        const id = this.parseReference(reference);
        const blobPath = path.join(this.storePath, `${id}.dat`);
        const metaPath = path.join(this.storePath, `${id}.meta.json`);

        try {
            // Load metadata
            const metaContent = await fs.readFile(metaPath, 'utf-8');
            const metadata: StoredBlobMetadata = JSON.parse(metaContent);

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
                default:
                    throw ResourceError.providerError(
                        'BlobStore',
                        'retrieve',
                        `Unknown format: ${format}`
                    );
            }
        } catch (_error) {
            throw ResourceError.resourceNotFound(`blob:${id}`);
        }
    }

    /**
     * Check if blob exists
     */
    async exists(reference: string): Promise<boolean> {
        await this.initialize();

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

    /**
     * Cleanup old blobs based on configuration
     */
    async cleanup(olderThan?: Date): Promise<number> {
        await this.initialize();

        const cleanupDays =
            this.config.cleanupAfterDays || BlobStore.DEFAULT_CONFIG.cleanupAfterDays;
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
                    const metadata: StoredBlobMetadata = JSON.parse(metaContent);

                    if (new Date(metadata.createdAt) < cutoffDate) {
                        await Promise.all([
                            fs.unlink(blobPath).catch(() => {}),
                            fs.unlink(metaPath).catch(() => {}),
                        ]);
                        deletedCount++;
                        logger.debug(`Cleaned up old blob: ${id}`);
                    }
                } catch (error) {
                    logger.warn(`Failed to process blob metadata ${metaFile}: ${String(error)}`);
                }
            }

            if (deletedCount > 0) {
                logger.info(`Blob cleanup: removed ${deletedCount} old blobs`);
            }

            return deletedCount;
        } catch (error) {
            logger.error(`Blob cleanup failed: ${String(error)}`);
            return 0;
        }
    }

    /**
     * Get storage statistics
     */
    async getStats(): Promise<{ count: number; totalSize: number; storePath: string }> {
        await this.initialize();

        try {
            const files = await fs.readdir(this.storePath);
            const datFiles = files.filter((f) => f.endsWith('.dat'));

            let totalSize = 0;
            for (const datFile of datFiles) {
                try {
                    const stat = await fs.stat(path.join(this.storePath, datFile));
                    totalSize += stat.size;
                } catch {
                    // Skip files that can't be stat'd
                }
            }

            return {
                count: datFiles.length,
                totalSize,
                storePath: this.storePath,
            };
        } catch (error) {
            logger.warn(`Failed to get blob store stats: ${String(error)}`);
            return { count: 0, totalSize: 0, storePath: this.storePath };
        }
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
                throw ResourceError.providerError(
                    'BlobStore',
                    'inputToBuffer',
                    'Unsupported data URI format'
                );
            }

            // Handle file path - only if it looks like an actual file path
            // Check if it's a valid file path by testing if it exists and is readable
            if ((input.includes('/') || input.includes('\\')) && input.length > 1) {
                try {
                    // Try to access the file to see if it exists
                    await fs.access(input);
                    return await fs.readFile(input);
                } catch (_error) {
                    // If file doesn't exist or can't be read, treat as base64
                    // This handles cases where base64 strings contain '/' or '\'
                }
            }

            // Assume base64 string
            try {
                return Buffer.from(input, 'base64');
            } catch (_error) {
                throw ResourceError.providerError(
                    'BlobStore',
                    'inputToBuffer',
                    'Invalid base64 string'
                );
            }
        }

        throw ResourceError.providerError(
            'BlobStore',
            'inputToBuffer',
            `Unsupported input type: ${typeof input}`
        );
    }

    /**
     * Parse blob reference to extract ID
     */
    private parseReference(reference: string): string {
        if (reference.startsWith('blob:')) {
            return reference.substring(5);
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
        if (header.length >= 4) {
            const signature = header.subarray(0, 4);
            if (signature.equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
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
