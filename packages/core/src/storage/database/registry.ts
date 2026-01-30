import type { DatabaseProvider } from './provider.js';
import { StorageError } from '../errors.js';
import { BaseRegistry, type RegistryErrorFactory } from '../../providers/base-registry.js';

/**
 * Error factory for database registry errors.
 * Uses StorageError for consistent error handling.
 */
const databaseErrorFactory: RegistryErrorFactory = {
    alreadyRegistered: (type: string) => StorageError.databaseProviderAlreadyRegistered(type),
    notFound: (type: string, availableTypes: string[]) =>
        StorageError.unknownDatabaseProvider(type, availableTypes),
};

/**
 * Registry for database providers.
 *
 * This registry manages available database implementations and provides
 * runtime validation for configurations. Providers can be registered from
 * both core (built-in) and application layers (custom).
 *
 * The registry follows a global singleton pattern to allow registration
 * before configuration loading, while maintaining type safety through
 * provider interfaces.
 *
 * Extends BaseRegistry for common registry functionality.
 */
export class DatabaseRegistry extends BaseRegistry<DatabaseProvider<any, any>> {
    constructor() {
        super(databaseErrorFactory);
    }

    /**
     * Get all registered providers.
     * Alias for getAll() for backward compatibility.
     *
     * @returns Array of providers
     */
    getProviders(): DatabaseProvider<any, any>[] {
        return this.getAll();
    }
}

/**
 * Global singleton registry for database providers.
 *
 * This registry is used by the createDatabase factory and can be extended
 * with custom providers before configuration loading.
 *
 * Example usage in CLI/server layer:
 * ```typescript
 * import { databaseRegistry } from '@dexto/core';
 * import { mongoProvider } from './storage/mongo-provider.js';
 *
 * // Register custom provider before loading config
 * databaseRegistry.register(mongoProvider);
 * ```
 */
export const databaseRegistry = new DatabaseRegistry();
