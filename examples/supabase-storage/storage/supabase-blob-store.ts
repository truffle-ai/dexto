import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { Readable } from 'stream';
import type {
    BlobStore,
    BlobInput,
    BlobMetadata,
    BlobReference,
    BlobData,
    BlobStats,
    StoredBlobMetadata,
} from '@dexto/core';
import type { IDextoLogger } from '@dexto/core';
import type { SupabaseBlobStoreConfig } from './supabase-provider.js';

/**
 * Database row structure for blob metadata in Supabase.
 */
interface BlobMetadataRow {
    id: string;
    mime_type: string;
    original_name: string | null;
    created_at: string;
    size: number;
    hash: string;
    source: string | null;
}

/**
 * Supabase blob store implementation.
 *
 * This implementation provides remote blob storage using Supabase Storage and Database.
 * Features include:
 *
 * - Remote storage via Supabase Storage API
 * - Metadata persistence in Supabase Database
 * - Content-based deduplication (same hash = same blob)
 * - Multi-format retrieval (base64, buffer, stream, signed URL)
 * - Proper error handling for network failures
 * - Connection lifecycle management
 * - Schema verification on connection with helpful setup messages
 *
 * Implementation notes:
 * - Blobs are stored in Supabase Storage with their hash as the filename
 * - Metadata is stored in a separate database table (default: 'blob_metadata')
 * - The 'path' format is not supported (remote storage only)
 * - Signed URLs are generated for the 'url' format (60 minute expiry)
 * - Deduplication is handled by checking if a blob with the same hash exists
 *
 * Setup requirements:
 * 1. Create a Supabase project at https://supabase.com
 * 2. Create a storage bucket (must match the 'bucket' config value)
 * 3. Create the metadata table using the SQL below (run in Supabase SQL Editor)
 * 4. Optionally configure Row Level Security (RLS) policies for access control
 *
 * Required database schema (run in Supabase SQL Editor before first use):
 * ```sql
 * CREATE TABLE IF NOT EXISTS blob_metadata (
 *   id TEXT PRIMARY KEY,
 *   mime_type TEXT NOT NULL,
 *   original_name TEXT,
 *   created_at TIMESTAMPTZ NOT NULL,
 *   size BIGINT NOT NULL,
 *   hash TEXT NOT NULL,
 *   source TEXT
 * );
 *
 * CREATE INDEX IF NOT EXISTS idx_blob_metadata_created_at ON blob_metadata(created_at);
 * CREATE INDEX IF NOT EXISTS idx_blob_metadata_hash ON blob_metadata(hash);
 * ```
 *
 * Note: If the table doesn't exist, connection will fail with a clear error
 * message containing the SQL to run.
 */
export class SupabaseBlobStore implements BlobStore {
    private config: SupabaseBlobStoreConfig;
    private client: SupabaseClient | null = null;
    private connected = false;
    private logger: IDextoLogger;
    private readonly maxBlobSize: number;
    private readonly tableName: string;

    constructor(config: SupabaseBlobStoreConfig, logger: IDextoLogger) {
        this.config = config;
        this.logger = logger;
        this.maxBlobSize = config.maxBlobSize;
        this.tableName = config.tableName;
    }

    async connect(): Promise<void> {
        if (this.connected) return;

        try {
            // Initialize Supabase client
            this.client = createClient(this.config.supabaseUrl, this.config.supabaseKey);

            // Verify bucket exists by attempting to list files
            const { error } = await this.client.storage.from(this.config.bucket).list('', {
                limit: 1,
            });

            if (error) {
                throw new Error(
                    `Failed to access bucket '${this.config.bucket}': ${error.message}`
                );
            }

            // Ensure metadata table exists
            await this.ensureSchema();

            this.connected = true;
            this.logger.info(`SupabaseBlobStore connected to bucket: ${this.config.bucket}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to connect to Supabase: ${message}`);
            throw new Error(`Supabase connection failed: ${message}`);
        }
    }

    async disconnect(): Promise<void> {
        this.connected = false;
        this.client = null;
        this.logger.info('SupabaseBlobStore disconnected');
    }

    isConnected(): boolean {
        return this.connected;
    }

    getStoreType(): string {
        return 'supabase';
    }

    getStoragePath(): string | undefined {
        // Remote storage has no local path
        return undefined;
    }

    async store(input: BlobInput, metadata: BlobMetadata = {}): Promise<BlobReference> {
        this.ensureConnected();

        // Convert input to buffer
        const buffer = await this.inputToBuffer(input);

        // Check size limit
        if (buffer.length > this.maxBlobSize) {
            throw new Error(
                `Blob size ${buffer.length} bytes exceeds maximum ${this.maxBlobSize} bytes`
            );
        }

        // Generate content-based hash for deduplication
        const hash = createHash('sha256').update(buffer).digest('hex').substring(0, 16);
        const id = hash;

        // Check if blob already exists (deduplication)
        const existingMetadata = await this.getMetadataFromDatabase(id);
        if (existingMetadata) {
            this.logger.debug(
                `Blob ${id} already exists, returning existing reference (deduplication)`
            );
            return {
                id,
                uri: `blob:${id}`,
                metadata: existingMetadata,
            };
        }

        // Create metadata
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
            // Upload to Supabase Storage
            const storagePath = this.getStoragePathInternal(id);
            const { error: uploadError } = await this.client!.storage.from(
                this.config.bucket
            ).upload(storagePath, buffer, {
                contentType: storedMetadata.mimeType,
                upsert: false, // Fail if already exists
            });

            if (uploadError) {
                throw new Error(`Upload failed: ${uploadError.message}`);
            }

            // Store metadata in database
            await this.saveMetadataToDatabase(storedMetadata);

            this.logger.debug(
                `Stored blob ${id} (${buffer.length} bytes, ${storedMetadata.mimeType})`
            );

            return {
                id,
                uri: `blob:${id}`,
                metadata: storedMetadata,
            };
        } catch (error) {
            // Cleanup on failure - attempt to remove from storage
            await this.deleteFromStorage(id).catch(() => {});
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to store blob: ${message}`);
        }
    }

    async retrieve(
        reference: string,
        format: 'base64' | 'buffer' | 'path' | 'stream' | 'url' = 'buffer'
    ): Promise<BlobData> {
        this.ensureConnected();

        const id = this.parseReference(reference);
        const metadata = await this.getMetadataFromDatabase(id);

        if (!metadata) {
            throw new Error(`Blob not found: ${reference}`);
        }

        // Handle different output formats
        switch (format) {
            case 'base64': {
                const buffer = await this.downloadFromStorage(id);
                return { format: 'base64', data: buffer.toString('base64'), metadata };
            }

            case 'buffer': {
                const buffer = await this.downloadFromStorage(id);
                return { format: 'buffer', data: buffer, metadata };
            }

            case 'path': {
                // Path format not supported for remote storage
                throw new Error(
                    'Path format not supported for Supabase storage. Use local blob storage for filesystem paths.'
                );
            }

            case 'stream': {
                const buffer = await this.downloadFromStorage(id);
                const stream = Readable.from(buffer);
                return { format: 'stream', data: stream as NodeJS.ReadableStream, metadata };
            }

            case 'url': {
                const storagePath = this.getStoragePathInternal(id);

                // Use public URL if bucket is configured as public
                if (this.config.public) {
                    const { data } = this.client!.storage.from(this.config.bucket).getPublicUrl(
                        storagePath
                    );

                    return { format: 'url', data: data.publicUrl, metadata };
                }

                // Generate a signed URL (valid for 60 minutes)
                const { data, error } = await this.client!.storage.from(
                    this.config.bucket
                ).createSignedUrl(storagePath, 3600); // 1 hour

                if (error || !data) {
                    throw new Error(
                        `Failed to create signed URL: ${error?.message || 'Unknown error'}`
                    );
                }

                return { format: 'url', data: data.signedUrl, metadata };
            }

            default:
                throw new Error(`Unsupported format: ${format}`);
        }
    }

    async exists(reference: string): Promise<boolean> {
        this.ensureConnected();

        const id = this.parseReference(reference);
        const metadata = await this.getMetadataFromDatabase(id);
        return metadata !== null;
    }

    async delete(reference: string): Promise<void> {
        this.ensureConnected();

        const id = this.parseReference(reference);

        // Check if exists
        const metadata = await this.getMetadataFromDatabase(id);
        if (!metadata) {
            throw new Error(`Blob not found: ${reference}`);
        }

        // Delete from storage
        await this.deleteFromStorage(id);

        // Delete metadata from database
        await this.deleteMetadataFromDatabase(id);

        this.logger.debug(`Deleted blob: ${id}`);
    }

    async cleanup(olderThan?: Date): Promise<number> {
        this.ensureConnected();

        // Default: clean up blobs older than configured days
        const cutoffDate =
            olderThan || new Date(Date.now() - this.config.cleanupAfterDays * 24 * 60 * 60 * 1000);
        let deletedCount = 0;

        try {
            // Query old blobs from database
            const { data: oldBlobs, error } = await this.client!.from(this.tableName)
                .select('id')
                .lt('created_at', cutoffDate.toISOString());

            if (error) {
                throw new Error(`Failed to query old blobs: ${error.message}`);
            }

            if (!oldBlobs || oldBlobs.length === 0) {
                this.logger.info('No old blobs to clean up');
                return 0;
            }

            // Delete each old blob
            for (const blob of oldBlobs) {
                try {
                    await this.delete(blob.id);
                    deletedCount++;
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    this.logger.warn(`Failed to delete old blob ${blob.id}: ${message}`);
                }
            }

            if (deletedCount > 0) {
                this.logger.info(`Blob cleanup: removed ${deletedCount} old blobs`);
            }

            return deletedCount;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Cleanup failed: ${message}`);
        }
    }

    async getStats(): Promise<BlobStats> {
        this.ensureConnected();

        try {
            // Query count and total size from database
            const { data, error } = await this.client!.from(this.tableName).select('size');

            if (error) {
                throw new Error(`Failed to get stats: ${error.message}`);
            }

            const count = data?.length || 0;
            const totalSize = data?.reduce((sum, row) => sum + (row.size || 0), 0) || 0;

            return {
                count,
                totalSize,
                backendType: 'supabase',
                storePath: `supabase://${this.config.bucket}`,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to get stats: ${message}`);
        }
    }

    async listBlobs(): Promise<BlobReference[]> {
        this.ensureConnected();

        try {
            // Query all blobs from database
            const { data, error } = await this.client!.from(this.tableName).select('*');

            if (error) {
                throw new Error(`Failed to list blobs: ${error.message}`);
            }

            if (!data) {
                return [];
            }

            // Convert database rows to BlobReference format
            return data.map((row: BlobMetadataRow) => ({
                id: row.id,
                uri: `blob:${row.id}`,
                metadata: this.rowToMetadata(row),
            }));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.warn(`Failed to list blobs: ${message}`);
            return [];
        }
    }

    // ==================== Private Helper Methods ====================

    /**
     * Ensure the store is connected, throw if not.
     */
    private ensureConnected(): void {
        if (!this.connected || !this.client) {
            throw new Error('Supabase blob store is not connected');
        }
    }

    /**
     * Ensure the metadata table schema exists by verifying we can query it.
     * If the table doesn't exist, provides clear error message with setup SQL.
     */
    private async ensureSchema(): Promise<void> {
        try {
            // Verify table exists by attempting a simple query
            const { error } = await this.client!.from(this.tableName).select('id').limit(1);

            if (error) {
                // Table might not exist - provide helpful error with SQL
                if (error.code === '42P01' || error.message.includes('does not exist')) {
                    const setupSQL = `
-- Run this SQL in your Supabase SQL Editor to create the blob metadata table:

CREATE TABLE IF NOT EXISTS ${this.tableName} (
    id TEXT PRIMARY KEY,
    mime_type TEXT NOT NULL,
    original_name TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    size BIGINT NOT NULL,
    hash TEXT NOT NULL,
    source TEXT
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_${this.tableName}_created_at ON ${this.tableName}(created_at);
CREATE INDEX IF NOT EXISTS idx_${this.tableName}_hash ON ${this.tableName}(hash);

-- Optional: Enable Row Level Security (RLS) for access control
-- ALTER TABLE ${this.tableName} ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Allow all operations for authenticated users" ON ${this.tableName}
--   FOR ALL USING (auth.role() = 'authenticated');
`.trim();

                    throw new Error(
                        `Table '${this.tableName}' does not exist in Supabase database.\n\n${setupSQL}`
                    );
                }

                // Some other error - report it
                throw new Error(`Failed to verify table '${this.tableName}': ${error.message}`);
            }

            this.logger.debug(`Verified table exists: ${this.tableName}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`Schema verification failed: ${message}`);
            throw error;
        }
    }

    /**
     * Get the full storage path for a blob ID.
     */
    private getStoragePathInternal(id: string): string {
        const prefix = this.config.pathPrefix || '';
        return prefix ? `${prefix}/${id}.dat` : `${id}.dat`;
    }

    /**
     * Download blob data from Supabase Storage.
     */
    private async downloadFromStorage(id: string): Promise<Buffer> {
        const storagePath = this.getStoragePathInternal(id);
        const { data, error } = await this.client!.storage.from(this.config.bucket).download(
            storagePath
        );

        if (error || !data) {
            throw new Error(`Failed to download blob: ${error?.message || 'No data returned'}`);
        }

        // Convert Blob to Buffer
        const arrayBuffer = await data.arrayBuffer();
        return Buffer.from(arrayBuffer);
    }

    /**
     * Delete blob from Supabase Storage.
     */
    private async deleteFromStorage(id: string): Promise<void> {
        const storagePath = this.getStoragePathInternal(id);
        const { error } = await this.client!.storage.from(this.config.bucket).remove([storagePath]);

        if (error) {
            throw new Error(`Failed to delete from storage: ${error.message}`);
        }
    }

    /**
     * Get blob metadata from database.
     */
    private async getMetadataFromDatabase(id: string): Promise<StoredBlobMetadata | null> {
        const { data, error } = await this.client!.from(this.tableName)
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            // 'PGRST116' is the error code for no rows returned
            if (error.code === 'PGRST116') {
                return null;
            }
            throw new Error(`Failed to get metadata: ${error.message}`);
        }

        if (!data) {
            return null;
        }

        return this.rowToMetadata(data as BlobMetadataRow);
    }

    /**
     * Save blob metadata to database.
     */
    private async saveMetadataToDatabase(metadata: StoredBlobMetadata): Promise<void> {
        const row: BlobMetadataRow = {
            id: metadata.id,
            mime_type: metadata.mimeType,
            original_name: metadata.originalName || null,
            created_at: metadata.createdAt.toISOString(),
            size: metadata.size,
            hash: metadata.hash,
            source: metadata.source || null,
        };

        const { error } = await this.client!.from(this.tableName).insert(row);

        if (error) {
            throw new Error(`Failed to save metadata: ${error.message}`);
        }
    }

    /**
     * Delete blob metadata from database.
     */
    private async deleteMetadataFromDatabase(id: string): Promise<void> {
        const { error } = await this.client!.from(this.tableName).delete().eq('id', id);

        if (error) {
            throw new Error(`Failed to delete metadata: ${error.message}`);
        }
    }

    /**
     * Convert database row to StoredBlobMetadata.
     */
    private rowToMetadata(row: BlobMetadataRow): StoredBlobMetadata {
        return {
            id: row.id,
            mimeType: row.mime_type,
            originalName: row.original_name || undefined,
            createdAt: new Date(row.created_at),
            size: row.size,
            hash: row.hash,
            source: (row.source as 'tool' | 'user' | 'system') || undefined,
        };
    }

    /**
     * Parse blob reference to extract ID.
     */
    private parseReference(reference: string): string {
        if (!reference) {
            throw new Error('Empty blob reference');
        }

        if (reference.startsWith('blob:')) {
            const id = reference.substring(5);
            if (!id) {
                throw new Error('Empty blob ID after prefix');
            }
            return id;
        }

        return reference;
    }

    /**
     * Convert various input types to Buffer.
     * Based on LocalBlobStore implementation.
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
                throw new Error('Unsupported data URI format (only base64 supported)');
            }

            // Assume base64 string
            try {
                return Buffer.from(input, 'base64');
            } catch {
                throw new Error('Invalid base64 string');
            }
        }

        throw new Error(`Unsupported input type: ${typeof input}`);
    }

    /**
     * Detect MIME type from buffer content and/or filename.
     * Basic implementation - can be extended with more sophisticated detection.
     */
    private detectMimeType(buffer: Buffer, filename?: string): string {
        // Check magic numbers
        const header = buffer.subarray(0, 16);

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
                ts: 'text/typescript',
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
