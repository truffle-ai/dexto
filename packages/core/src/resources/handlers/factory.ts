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
        return new FileSystemResourceHandler(config);
    }
    if (type === 'blob') {
        if (!services.blobService) {
            throw ResourceError.providerError(
                'Internal',
                'createInternalResourceHandler',
                'BlobService is required for blob resource handler'
            );
        }
        return new BlobResourceHandler(config, services.blobService);
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
