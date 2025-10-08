import { ResourceError } from './errors.js';
import { FileSystemResourceHandler } from './handlers/filesystem-handler.js';
import { BlobResourceHandler } from './handlers/blob-handler.js';

// Re-export types and handlers
export type {
    FileSystemResourceConfig,
    BlobResourceConfig,
    InternalResourceConfig,
    InternalResourceServices,
    InternalResourceHandler,
} from './handlers/types.js';
export { FileSystemResourceHandler } from './handlers/filesystem-handler.js';
export { BlobResourceHandler } from './handlers/blob-handler.js';

// Factory function for creating handlers
export function createInternalResourceHandler(
    config: import('./handlers/types.js').InternalResourceConfig,
    services: import('./handlers/types.js').InternalResourceServices
): import('./handlers/types.js').InternalResourceHandler {
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

export function getInternalResourceHandlerTypes(): string[] {
    return ['filesystem', 'blob'];
}
