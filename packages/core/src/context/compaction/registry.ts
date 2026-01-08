import type { CompactionProvider } from './provider.js';
import { ContextError } from '../errors.js';
import { BaseRegistry, type RegistryErrorFactory } from '../../providers/base-registry.js';

/**
 * Error factory for compaction registry errors.
 * Uses ContextError for consistent error handling.
 */
const compactionErrorFactory: RegistryErrorFactory = {
    alreadyRegistered: (type: string) => ContextError.compactionProviderAlreadyRegistered(type),
    notFound: (type: string, availableTypes: string[]) =>
        ContextError.compactionInvalidType(type, availableTypes),
};

/**
 * Global registry for compaction providers.
 *
 * Follows the same pattern as blob storage and tools registries:
 * - Singleton instance exported
 * - Registration before agent initialization
 * - Type-safe provider lookup
 *
 * Extends BaseRegistry for common registry functionality.
 */
class CompactionRegistry extends BaseRegistry<CompactionProvider<any, any>> {
    constructor() {
        super(compactionErrorFactory);
    }
}

/** Global singleton instance */
export const compactionRegistry = new CompactionRegistry();
