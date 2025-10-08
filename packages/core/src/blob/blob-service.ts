import { logger } from '../logger/index.js';
import { BlobError } from './errors.js';
import { LocalBlobBackend } from './backend/local-backend.js';
import type {
    BlobService as IBlobService,
    BlobBackend,
    BlobServiceConfig,
    BlobInput,
    BlobMetadata,
    BlobReference,
    BlobData,
    BlobStats,
} from './types.js';

/**
 * Main blob service implementation for local filesystem storage
 *
 * Provides blob storage operations using the local filesystem backend.
 */
// TODO: (355) See how this can be integrated into existing storage modules and what needs to be refactored for that
// Notes:
// - we likely don't need this class and can use storage-manager
// - error codes don't need blob scope, but storage scope
// - new backends would move into storage/backend
// - new schemas move into storage/schemas and types in storage/types
// https://github.com/truffle-ai/dexto/pull/355#discussion_r2412970941
export class BlobService implements IBlobService {
    private backend: BlobBackend;
    private config: BlobServiceConfig;
    private connected = false;

    constructor(config: BlobServiceConfig) {
        this.config = config;
        this.backend = new LocalBlobBackend(config);
    }

    /**
     * Connect to the blob storage backend
     */
    async connect(): Promise<void> {
        if (this.connected) return;

        try {
            await this.backend.connect();
            this.connected = true;
            logger.info(`BlobService connected using ${this.backend.getBackendType()} backend`);
        } catch (error) {
            logger.error(`Failed to connect BlobService: ${error}`);
            throw BlobError.backendUnavailable(this.backend.getBackendType(), error);
        }
    }

    /**
     * Disconnect from the blob storage backend
     */
    async disconnect(): Promise<void> {
        if (!this.connected) return;

        try {
            await this.backend.disconnect();
            this.connected = false;
            logger.info('BlobService disconnected');
        } catch (error) {
            logger.warn(`Error during BlobService disconnect: ${error}`);
            // Don't throw - disconnection errors are usually not critical
        }
    }

    /**
     * Check if service is connected
     */
    isConnected(): boolean {
        return this.connected && this.backend.isConnected();
    }

    /**
     * Get the current backend instance
     */
    getBackend(): BlobBackend {
        return this.backend;
    }

    /**
     * Store blob data and return a reference
     */
    async store(input: BlobInput, metadata?: BlobMetadata): Promise<BlobReference> {
        this.ensureConnected();
        return this.backend.store(input, metadata);
    }

    /**
     * Retrieve blob data in specified format
     */
    async retrieve(
        reference: string,
        format?: 'base64' | 'buffer' | 'path' | 'stream' | 'url'
    ): Promise<BlobData> {
        this.ensureConnected();
        return this.backend.retrieve(reference, format);
    }

    /**
     * Check if blob exists
     */
    async exists(reference: string): Promise<boolean> {
        this.ensureConnected();
        return this.backend.exists(reference);
    }

    /**
     * Delete a blob
     */
    async delete(reference: string): Promise<void> {
        this.ensureConnected();
        return this.backend.delete(reference);
    }

    /**
     * Cleanup old blobs based on configuration
     */
    async cleanup(olderThan?: Date): Promise<number> {
        this.ensureConnected();
        return this.backend.cleanup(olderThan);
    }

    /**
     * Get storage statistics
     */
    async getStats(): Promise<BlobStats> {
        this.ensureConnected();
        return this.backend.getStats();
    }

    /**
     * List all blob references (for resource enumeration)
     */
    async listBlobs(): Promise<BlobReference[]> {
        this.ensureConnected();
        if (this.backend.listBlobs) {
            return this.backend.listBlobs();
        }
        // Fallback for backends that don't support listing
        return [];
    }

    /**
     * Get current configuration
     */
    getConfig(): BlobServiceConfig {
        return { ...this.config };
    }

    /**
     * Get service health information
     */
    async getHealth(): Promise<{
        connected: boolean;
        backendType: string;
        stats: BlobStats;
    }> {
        const connected = this.isConnected();
        const backendType = this.backend.getBackendType();

        let stats: BlobStats;
        try {
            stats = connected
                ? await this.getStats()
                : {
                      count: 0,
                      totalSize: 0,
                      backendType,
                      storePath: this.config.storePath || '',
                  };
        } catch (error) {
            logger.warn(`Failed to get blob stats for health check: ${error}`);
            stats = {
                count: 0,
                totalSize: 0,
                backendType,
                storePath: this.config.storePath || '',
            };
        }

        return {
            connected,
            backendType,
            stats,
        };
    }

    /**
     * Ensure service is connected before operations
     */
    private ensureConnected(): void {
        if (!this.isConnected()) {
            throw BlobError.backendNotConnected(this.backend.getBackendType());
        }
    }
}

/**
 * Factory function to create and initialize a BlobService
 */
export async function createBlobService(config: BlobServiceConfig): Promise<BlobService> {
    const service = new BlobService(config);
    await service.connect();
    return service;
}
