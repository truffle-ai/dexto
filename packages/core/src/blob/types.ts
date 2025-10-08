/**
 * Core types for the Blob Service system
 *
 * The blob service handles large, unstructured data storage using
 * the local filesystem backend.
 */

import type { ValidatedBlobServiceConfig } from './schemas.js';

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
    storePath: string;
}

// TODO: (355) Remove BlobServiceConfig alias - use ValidatedBlobServiceConfig directly everywhere
// Update imports in blob-service.ts, local-backend.ts, and index.ts to import ValidatedBlobServiceConfig from schemas.ts
// Then delete this alias completely
// https://github.com/truffle-ai/dexto/pull/355#discussion_r2412998359
/**
 * Blob service configuration (derived from schema with validation and defaults)
 *
 * This type is derived from BlobServiceConfigSchema and represents the validated
 * configuration after defaults have been applied during agent initialization.
 */
export type BlobServiceConfig = ValidatedBlobServiceConfig;

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
