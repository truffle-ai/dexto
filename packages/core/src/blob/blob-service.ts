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
     * Create S3 backend - TODO: Implement S3BlobBackend
     *
     * TODO: Implement S3 blob storage backend:
     * - Add AWS SDK dependency
     * - Create S3BlobBackend class implementing BlobBackend interface
     * - Support S3-compatible services (MinIO, etc.) via endpoint config
     * - Handle AWS credential chain (access keys, IAM roles, etc.)
     * - Implement proper error handling for S3 operations
     */
    private createS3Backend(_config: S3BlobBackendConfig): BlobBackend {
        throw BlobError.invalidConfig(
            'S3 backend not yet implemented. Please use local backend or implement S3BlobBackend.',
            { backendType: 's3' }
        );
    }

    /**
     * Create GCS backend - TODO: Implement GCSBlobBackend
     *
     * TODO: Implement Google Cloud Storage blob backend:
     * - Add @google-cloud/storage dependency
     * - Create GCSBlobBackend class implementing BlobBackend interface
     * - Support service account authentication (key file or default credentials)
     * - Handle GCS-specific operations and error codes
     * - Implement proper bucket and object lifecycle management
     */
    private createGCSBackend(_config: GCSBlobBackendConfig): BlobBackend {
        throw BlobError.invalidConfig(
            'GCS backend not yet implemented. Please use local backend or implement GCSBlobBackend.',
            { backendType: 'gcs' }
        );
    }

    /**
     * Create Azure backend - TODO: Implement AzureBlobBackend
     *
     * TODO: Implement Azure Blob Storage backend:
     * - Add @azure/storage-blob dependency
     * - Create AzureBlobBackend class implementing BlobBackend interface
     * - Support connection string and managed identity authentication
     * - Handle Azure-specific blob operations and container management
     * - Implement proper error handling for Azure storage exceptions
     */
    private createAzureBackend(_config: AzureBlobBackendConfig): BlobBackend {
        throw BlobError.invalidConfig(
            'Azure backend not yet implemented. Please use local backend or implement AzureBlobBackend.',
            { backendType: 'azure' }
        );
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
     * Switch to a different backend configuration - TODO: Implement if needed
     *
     * TODO: Implement backend switching if runtime configuration changes are required:
     * - Add proper data migration between backends
     * - Handle graceful failover scenarios
     * - Implement rollback mechanism for failed switches
     * - Add validation to ensure new backend can handle existing blob references
     *
     * Note: This method is currently unused and may not be needed for most use cases.
     * Consider removing if not required, or implement with proper data migration.
     */
    async switchBackend(_config: BlobServiceConfig): Promise<void> {
        throw BlobError.invalidConfig(
            'Backend switching not yet implemented. Create a new BlobService instance instead.'
        );
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
