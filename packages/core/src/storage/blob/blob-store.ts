import type {
    BlobInput,
    BlobMetadata,
    BlobReference,
    BlobData,
    BlobStats,
} from '../../blob/types.js';

/**
 * BlobStore interface for storing and retrieving large, unstructured data.
 * All implementations must provide these methods for blob operations.
 *
 * This interface follows the storage module conventions where:
 * - Interface name: BlobStore
 * - Implementation names: MemoryBlobStore, LocalBlobStore, etc.
 * - Lifecycle methods: connect(), disconnect(), isConnected()
 * - Type identifier: getStoreType()
 */
export interface BlobStore {
    /**
     * Store blob data and return a reference.
     * @param input - The blob data to store (string, Uint8Array, Buffer, ArrayBuffer)
     * @param metadata - Optional metadata to associate with the blob
     * @returns Promise resolving to a BlobReference with id, uri, and metadata
     */
    store(input: BlobInput, metadata?: BlobMetadata): Promise<BlobReference>;

    /**
     * Retrieve blob data in the specified format.
     * @param reference - The blob reference (id or uri)
     * @param format - The desired output format (base64, buffer, path, stream, url)
     * @returns Promise resolving to BlobData with the requested format
     */
    retrieve(
        reference: string,
        format?: 'base64' | 'buffer' | 'path' | 'stream' | 'url'
    ): Promise<BlobData>;

    /**
     * Check if a blob exists.
     * @param reference - The blob reference (id or uri)
     * @returns Promise resolving to true if the blob exists, false otherwise
     */
    exists(reference: string): Promise<boolean>;

    /**
     * Delete a blob.
     * @param reference - The blob reference (id or uri)
     * @returns Promise resolving when the blob is deleted
     */
    delete(reference: string): Promise<void>;

    /**
     * Cleanup old blobs based on age.
     * @param olderThan - Optional date to delete blobs created before
     * @returns Promise resolving to the number of blobs deleted
     */
    cleanup(olderThan?: Date): Promise<number>;

    /**
     * Get storage statistics.
     * @returns Promise resolving to BlobStats with count, size, type, and path info
     */
    getStats(): Promise<BlobStats>;

    /**
     * List all blob references (for resource enumeration).
     * @returns Promise resolving to an array of BlobReferences
     */
    listBlobs(): Promise<BlobReference[]>;

    /**
     * Get the local filesystem storage path for this store, if applicable.
     * Used to prevent conflicts with filesystem resource scanning.
     * @returns The storage path string, or undefined for remote stores (S3, Azure, etc.)
     */
    getStoragePath(): string | undefined;

    /**
     * Connect to the blob store and initialize resources.
     * @returns Promise resolving when the store is ready for operations
     */
    connect(): Promise<void>;

    /**
     * Disconnect from the blob store and cleanup resources.
     * @returns Promise resolving when the store is fully disconnected
     */
    disconnect(): Promise<void>;

    /**
     * Check if the blob store is currently connected.
     * @returns true if connected, false otherwise
     */
    isConnected(): boolean;

    /**
     * Get the type identifier for this blob store implementation.
     * @returns A string identifying the store type (e.g., 'memory', 'local', 's3')
     */
    getStoreType(): string;
}
