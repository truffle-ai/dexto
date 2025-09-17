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
    LocalBlobBackendConfig,
    S3BlobBackendConfig,
    GCSBlobBackendConfig,
    AzureBlobBackendConfig,
} from './types.js';

/**
 * Main blob service implementation that manages blob storage backends
 *
 * Provides a unified interface for blob storage operations while supporting
 * multiple backend types (local filesystem, S3, GCS, Azure, etc.)
 */
export class BlobService implements IBlobService {
    private backend: BlobBackend;
    private config: BlobServiceConfig;
    private connected = false;

    constructor(config: BlobServiceConfig) {
        this.config = config;
        this.backend = this.createBackend(config);
    }

    /**
     * Create backend instance based on configuration
     */
    private createBackend(config: BlobServiceConfig): BlobBackend {
        switch (config.type) {
            case 'local':
                return new LocalBlobBackend(config as LocalBlobBackendConfig);

            case 's3':
                // Lazy load S3 backend to avoid dependency issues
                return this.createS3Backend(config as S3BlobBackendConfig);

            case 'gcs':
                // Lazy load GCS backend
                return this.createGCSBackend(config as GCSBlobBackendConfig);

            case 'azure':
                // Lazy load Azure backend
                return this.createAzureBackend(config as AzureBlobBackendConfig);

            default: {
                // Type-safe exhaustive check
                const _exhaustive: never = config;
                throw BlobError.invalidBackendType((_exhaustive as any).type || 'unknown');
            }
        }
    }

    /**
     * Create S3 backend with lazy loading
     */
    private createS3Backend(config: S3BlobBackendConfig): BlobBackend {
        try {
            // TODO: Implement S3BlobBackend in Phase 3
            throw new Error('S3 backend not yet implemented - coming in Phase 3');
        } catch (error) {
            logger.warn(`S3 backend not available, falling back to local: ${error}`);
            // Fallback to local backend
            return new LocalBlobBackend({
                type: 'local',
                maxBlobSize: config.maxBlobSize,
                maxTotalSize: config.maxTotalSize,
                cleanupAfterDays: config.cleanupAfterDays,
            });
        }
    }

    /**
     * Create GCS backend with lazy loading
     */
    private createGCSBackend(config: GCSBlobBackendConfig): BlobBackend {
        try {
            // TODO: Implement GCSBlobBackend in Phase 3
            throw new Error('GCS backend not yet implemented - coming in Phase 3');
        } catch (error) {
            logger.warn(`GCS backend not available, falling back to local: ${error}`);
            // Fallback to local backend
            return new LocalBlobBackend({
                type: 'local',
                maxBlobSize: config.maxBlobSize,
                maxTotalSize: config.maxTotalSize,
                cleanupAfterDays: config.cleanupAfterDays,
            });
        }
    }

    /**
     * Create Azure backend with lazy loading
     */
    private createAzureBackend(config: AzureBlobBackendConfig): BlobBackend {
        try {
            // TODO: Implement AzureBlobBackend in Phase 3
            throw new Error('Azure backend not yet implemented - coming in Phase 3');
        } catch (error) {
            logger.warn(`Azure backend not available, falling back to local: ${error}`);
            // Fallback to local backend
            return new LocalBlobBackend({
                type: 'local',
                maxBlobSize: config.maxBlobSize,
                maxTotalSize: config.maxTotalSize,
                cleanupAfterDays: config.cleanupAfterDays,
            });
        }
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
     * Switch to a different backend configuration
     * This is useful for runtime configuration changes
     */
    async switchBackend(config: BlobServiceConfig): Promise<void> {
        logger.info(
            `Switching blob backend from ${this.backend.getBackendType()} to ${config.type}`
        );

        // Disconnect current backend
        if (this.connected) {
            await this.disconnect();
        }

        // Create new backend
        this.config = config;
        this.backend = this.createBackend(config);

        // Connect to new backend
        await this.connect();
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
                  };
        } catch (error) {
            logger.warn(`Failed to get blob stats for health check: ${error}`);
            stats = {
                count: 0,
                totalSize: 0,
                backendType,
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
