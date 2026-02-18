import type { Logger } from '../../logger/v2/types.js';
import { DextoLogComponent } from '../../logger/v2/types.js';
import { ResourceError } from '../errors.js';
import type { ResourceMetadata } from '../types.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import type { BlobStore, StoredBlobMetadata } from '../../storage/blob/types.js';
import type { ValidatedBlobResourceConfig } from '../schemas.js';
import type { InternalResourceHandler, InternalResourceServices } from './types.js';

export class BlobResourceHandler implements InternalResourceHandler {
    private config: ValidatedBlobResourceConfig;
    private blobStore: BlobStore;
    private logger: Logger;

    constructor(config: ValidatedBlobResourceConfig, blobStore: BlobStore, logger: Logger) {
        this.config = config;
        this.blobStore = blobStore;
        this.logger = logger.createChild(DextoLogComponent.RESOURCE);
    }

    getType(): string {
        return 'blob';
    }

    async initialize(_services: InternalResourceServices): Promise<void> {
        // Config and blobStore are set in constructor
        this.logger.debug('BlobResourceHandler initialized with BlobStore');
    }

    async listResources(): Promise<ResourceMetadata[]> {
        this.logger.debug('🔍 BlobResourceHandler.listResources() called');

        try {
            const stats = await this.blobStore.getStats();
            this.logger.debug(
                `📊 BlobStore stats: ${stats.count} blobs, backend: ${stats.backendType}`
            );
            const resources: ResourceMetadata[] = [];

            // List individual blobs from the store
            try {
                const blobs = await this.blobStore.listBlobs();
                this.logger.debug(`📄 Found ${blobs.length} individual blobs`);

                for (const blob of blobs) {
                    // Filter out 'system' source blobs (prompt .md files, custom prompt attachments).
                    // These are internal config accessed via prompt system, not @-referenceable resources.
                    // Prevents clutter and confusion in resource autocomplete.
                    if (blob.metadata.source === 'system') {
                        continue;
                    }

                    // Generate a user-friendly name with proper extension
                    const displayName = this.generateBlobDisplayName(blob.metadata, blob.id);
                    const friendlyType = this.getFriendlyType(blob.metadata.mimeType);

                    resources.push({
                        uri: blob.uri,
                        name: displayName,
                        description: `${friendlyType} (${this.formatSize(blob.metadata.size)})${blob.metadata.source ? ` • ${blob.metadata.source}` : ''}`,
                        source: 'internal',
                        size: blob.metadata.size,
                        mimeType: blob.metadata.mimeType,
                        lastModified: new Date(blob.metadata.createdAt),
                        metadata: {
                            type: 'blob',
                            source: blob.metadata.source,
                            hash: blob.metadata.hash,
                            createdAt: blob.metadata.createdAt,
                            originalName: blob.metadata.originalName,
                        },
                    });
                }
            } catch (error) {
                this.logger.warn(`Failed to list individual blobs: ${String(error)}`);
            }

            this.logger.debug(`✅ BlobResourceHandler returning ${resources.length} resources`);
            return resources;
        } catch (error) {
            this.logger.warn(`Failed to list blob resources: ${String(error)}`);
            return [];
        }
    }

    canHandle(uri: string): boolean {
        return uri.startsWith('blob:');
    }

    async readResource(uri: string): Promise<ReadResourceResult> {
        if (!this.canHandle(uri)) {
            throw ResourceError.noSuitableProvider(uri);
        }

        try {
            // Extract blob ID from URI (remove 'blob:' prefix)
            const blobId = uri.substring(5);

            // Validate blob ID
            if (!blobId) {
                throw ResourceError.readFailed(uri, new Error('Invalid blob URI: missing blob ID'));
            }

            // Special case: blob store info
            if (blobId === 'store') {
                const stats = await this.blobStore.getStats();
                return {
                    contents: [
                        {
                            uri,
                            mimeType: 'application/json',
                            text: JSON.stringify(stats, null, 2),
                        },
                    ],
                };
            }

            // Retrieve actual blob data using blob ID
            const result = await this.blobStore.retrieve(blobId, 'base64');

            return {
                contents: [
                    {
                        uri,
                        mimeType: result.metadata.mimeType || 'application/octet-stream',
                        blob: result.data as string, // base64 data from retrieve call
                    },
                ],
                _meta: {
                    size: result.metadata.size,
                    createdAt: result.metadata.createdAt,
                    originalName: result.metadata.originalName,
                    source: result.metadata.source,
                },
            };
        } catch (error) {
            if (error instanceof ResourceError) {
                throw error;
            }
            throw ResourceError.readFailed(uri, error);
        }
    }

    async refresh(): Promise<void> {
        // BlobStore doesn't need refresh as it's not file-system based scanning
        // But we can perform cleanup of old blobs if configured
        try {
            await this.blobStore.cleanup();
            this.logger.debug('Blob store cleanup completed');
        } catch (error) {
            this.logger.warn(`Blob store cleanup failed: ${String(error)}`);
        }
    }

    getBlobStore(): BlobStore {
        return this.blobStore;
    }

    /**
     * Generate a user-friendly display name for a blob with proper file extension
     */
    private generateBlobDisplayName(metadata: StoredBlobMetadata, _blobId: string): string {
        // If we have an original name with extension, use it
        if (metadata.originalName && metadata.originalName.includes('.')) {
            return metadata.originalName;
        }

        // Generate a name based on MIME type and content
        let baseName =
            metadata.originalName || this.generateNameFromType(metadata.mimeType, metadata.source);
        const extension = this.getExtensionFromMimeType(metadata.mimeType);

        // Add extension if not present
        if (extension && !baseName.toLowerCase().endsWith(extension)) {
            baseName += extension;
        }

        return baseName;
    }

    /**
     * Generate a descriptive base name from MIME type and source
     */
    private generateNameFromType(mimeType: string, source?: string): string {
        if (mimeType.startsWith('image/')) {
            if (source === 'user') return 'uploaded-image';
            if (source === 'tool') return 'generated-image';
            return 'image';
        }
        if (mimeType.startsWith('text/')) {
            if (source === 'tool') return 'tool-output';
            return 'text-file';
        }
        if (mimeType.startsWith('application/pdf')) {
            return 'document';
        }
        if (mimeType.startsWith('audio/')) {
            return 'audio-file';
        }
        if (mimeType.startsWith('video/')) {
            return 'video-file';
        }

        // Default based on source
        if (source === 'user') return 'user-upload';
        if (source === 'tool') return 'tool-result';
        return 'file';
    }

    /**
     * Get file extension from MIME type
     */
    private getExtensionFromMimeType(mimeType: string): string {
        const mimeToExt: Record<string, string> = {
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'image/gif': '.gif',
            'image/webp': '.webp',
            'image/svg+xml': '.svg',
            'text/plain': '.txt',
            'text/markdown': '.md',
            'text/html': '.html',
            'text/css': '.css',
            'application/json': '.json',
            'application/pdf': '.pdf',
            'application/xml': '.xml',
            'audio/mpeg': '.mp3',
            'audio/wav': '.wav',
            'video/mp4': '.mp4',
            'video/webm': '.webm',
        };

        return mimeToExt[mimeType] || '';
    }

    /**
     * Convert MIME type to user-friendly type description
     */
    private getFriendlyType(mimeType: string): string {
        if (mimeType.startsWith('image/')) return 'Image';
        if (mimeType.startsWith('text/')) return 'Text File';
        if (mimeType.startsWith('audio/')) return 'Audio File';
        if (mimeType.startsWith('video/')) return 'Video File';
        if (mimeType === 'application/pdf') return 'PDF Document';
        if (mimeType === 'application/json') return 'JSON Data';
        return 'File';
    }

    /**
     * Format file size in human-readable format
     */
    private formatSize(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
}
