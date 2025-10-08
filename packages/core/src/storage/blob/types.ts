/**
 * Core types for Blob Storage
 *
 * Blob storage handles large, unstructured data using various backends.
 * This module is part of the storage system.
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
    storePath: string;
}
