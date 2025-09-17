/**
 * Core types for the Blob Service system
 *
 * The blob service handles large, unstructured data storage with support
 * for multiple backends (local filesystem, S3, GCS, Azure, etc.)
 */

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
    uri: string; // blob:id format for compatibility
    metadata: StoredBlobMetadata;
}

/**
 * Retrieved blob data in requested format
 */
export type BlobData =
    | { format: 'base64'; data: string; metadata: StoredBlobMetadata }
    | { format: 'buffer'; data: Buffer; metadata: StoredBlobMetadata }
    | { format: 'path'; data: string; metadata: StoredBlobMetadata }
    | { format: 'stream'; data: NodeJS.ReadableStream; metadata: StoredBlobMetadata }
    | { format: 'url'; data: string; metadata: StoredBlobMetadata };

/**
 * Storage statistics for monitoring and management
 */
export interface BlobStats {
    count: number;
    totalSize: number;
    backendType: string;
    storePath?: string; // For local backend
    bucket?: string; // For cloud backends
}

/**
 * Configuration for blob storage backends
 */
export interface BlobBackendConfig {
    maxBlobSize?: number | undefined; // Max size per blob in bytes
    maxTotalSize?: number | undefined; // Max total storage size in bytes
    cleanupAfterDays?: number | undefined; // Auto-cleanup blobs older than N days
}

/**
 * Local filesystem backend configuration
 */
export interface LocalBlobBackendConfig extends BlobBackendConfig {
    type: 'local';
    storePath?: string | undefined; // Custom storage path
}

/**
 * S3-compatible backend configuration
 */
export interface S3BlobBackendConfig extends BlobBackendConfig {
    type: 's3';
    bucket: string;
    region: string;
    accessKeyId?: string | undefined; // If not provided, uses AWS SDK default credential chain
    secretAccessKey?: string | undefined;
    endpoint?: string | undefined; // For S3-compatible services like MinIO
}

/**
 * Google Cloud Storage backend configuration
 */
export interface GCSBlobBackendConfig extends BlobBackendConfig {
    type: 'gcs';
    bucket: string;
    projectId: string;
    keyFilename?: string | undefined; // Path to service account key file
}

/**
 * Azure Blob Storage backend configuration
 */
export interface AzureBlobBackendConfig extends BlobBackendConfig {
    type: 'azure';
    containerName: string;
    connectionString?: string | undefined; // If not provided, uses environment variables
}

/**
 * Union type for all backend configurations
 */
export type BlobServiceConfig =
    | LocalBlobBackendConfig
    | S3BlobBackendConfig
    | GCSBlobBackendConfig
    | AzureBlobBackendConfig;

/**
 * Backend interface that all blob storage implementations must follow
 */
export interface BlobBackend {
    /**
     * Store blob data and return a reference
     */
    store(input: BlobInput, metadata?: BlobMetadata): Promise<BlobReference>;

    /**
     * Retrieve blob data in specified format
     */
    retrieve(
        reference: string,
        format?: 'base64' | 'buffer' | 'path' | 'stream' | 'url'
    ): Promise<BlobData>;

    /**
     * Check if blob exists
     */
    exists(reference: string): Promise<boolean>;

    /**
     * Delete a blob
     */
    delete(reference: string): Promise<void>;

    /**
     * Cleanup old blobs based on configuration
     */
    cleanup(olderThan?: Date): Promise<number>;

    /**
     * Get storage statistics
     */
    getStats(): Promise<BlobStats>;

    /**
     * List all blob references (for resource enumeration)
     * Note: This may not be supported by all backends
     */
    listBlobs?(): Promise<BlobReference[]>;

    /**
     * Backend lifecycle management
     */
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    isConnected(): boolean;
    getBackendType(): string;
}

/**
 * Main blob service interface - provides unified access to blob storage
 */
export interface BlobService {
    /**
     * Get the current backend instance
     */
    getBackend(): BlobBackend;

    /**
     * Store blob data and return a reference
     */
    store(input: BlobInput, metadata?: BlobMetadata): Promise<BlobReference>;

    /**
     * Retrieve blob data in specified format
     */
    retrieve(
        reference: string,
        format?: 'base64' | 'buffer' | 'path' | 'stream' | 'url'
    ): Promise<BlobData>;

    /**
     * Check if blob exists
     */
    exists(reference: string): Promise<boolean>;

    /**
     * Delete a blob
     */
    delete(reference: string): Promise<void>;

    /**
     * Cleanup old blobs based on configuration
     */
    cleanup(olderThan?: Date): Promise<number>;

    /**
     * Get storage statistics
     */
    getStats(): Promise<BlobStats>;

    /**
     * List all blob references (for resource enumeration)
     * Note: This may not be supported by all backends
     */
    listBlobs?(): Promise<BlobReference[]>;

    /**
     * Service lifecycle management
     */
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    isConnected(): boolean;
}
