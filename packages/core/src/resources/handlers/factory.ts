import { ResourceError } from '../errors.js';
import { FileSystemResourceHandler } from './filesystem-handler.js';
import { BlobResourceHandler } from './blob-handler.js';
import type { InternalResourceServices, InternalResourceHandler } from './types.js';
import type { ValidatedInternalResourceConfig } from '../schemas.js';

/**
 * Factory function for creating internal resource handlers
 */
export function createInternalResourceHandler(
    config: ValidatedInternalResourceConfig,
    services: InternalResourceServices
): InternalResourceHandler {
    const type = config.type;
    if (type === 'filesystem') {
        // Pass blob storage path to filesystem handler to avoid scanning blob directories
        const blobStoragePath = services.blobStore.getStoragePath();
        return new FileSystemResourceHandler(config, blobStoragePath);
    }
    if (type === 'blob') {
        return new BlobResourceHandler(config, services.blobStore);
    }
    throw ResourceError.providerError(
        'Internal',
        'createInternalResourceHandler',
        `Unsupported internal resource handler type: ${type}`
    );
}

/**
 * Get all supported internal resource handler types
 */
export function getInternalResourceHandlerTypes(): string[] {
    return ['filesystem', 'blob'];
}
