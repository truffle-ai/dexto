import type { CompressionProvider } from './provider.js';
import { ContextError } from '../errors.js';
import { BaseRegistry, type RegistryErrorFactory } from '../../providers/base-registry.js';

/**
 * Error factory for compression registry errors.
 * Uses ContextError for consistent error handling.
 */
const compressionErrorFactory: RegistryErrorFactory = {
    alreadyRegistered: (type: string) => ContextError.compressionProviderAlreadyRegistered(type),
    notFound: (type: string, availableTypes: string[]) =>
        ContextError.compressionInvalidType(type, availableTypes),
};

/**
 * Global registry for compression providers.
 *
 * Follows the same pattern as blob storage and tools registries:
 * - Singleton instance exported
 * - Registration before agent initialization
 * - Type-safe provider lookup
 *
 * Extends BaseRegistry for common registry functionality.
 */
class CompressionRegistry extends BaseRegistry<CompressionProvider<any, any>> {
    constructor() {
        super(compressionErrorFactory);
    }
}

/** Global singleton instance */
export const compressionRegistry = new CompressionRegistry();
