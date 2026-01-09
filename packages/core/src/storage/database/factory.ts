import type { Database } from './types.js';
import type { IDextoLogger } from '../../logger/v2/types.js';
import { databaseRegistry } from './registry.js';

/**
 * Create a database based on configuration using the provider registry.
 *
 * This factory function:
 * 1. Validates the configuration against the registered provider's schema
 * 2. Looks up the provider in the registry
 * 3. Calls the provider's create method to instantiate the database
 *
 * The configuration type is determined at runtime by the 'type' field,
 * which must match a registered provider. Custom providers can be registered
 * via databaseRegistry.register() before calling this function.
 *
 * Database paths are provided via CLI enrichment layer (for sqlite).
 *
 * @param config - Database configuration with a 'type' discriminator
 * @param logger - Logger instance for the database
 * @returns A Database implementation
 * @throws Error if the provider type is not registered or validation fails
 *
 * @example
 * ```typescript
 * // Using built-in provider
 * const db = await createDatabase({ type: 'sqlite', path: '/tmp/data.db' }, logger);
 *
 * // Using custom provider (registered beforehand)
 * import { databaseRegistry } from '@dexto/core';
 * import { mongoProvider } from './storage/mongo-provider.js';
 *
 * databaseRegistry.register(mongoProvider);
 * const db = await createDatabase({ type: 'mongodb', uri: '...' }, logger);
 * ```
 */
export async function createDatabase(
    config: { type: string; [key: string]: any },
    logger: IDextoLogger
): Promise<Database> {
    // Validate config against provider schema and get provider
    const validatedConfig = databaseRegistry.validateConfig(config);
    const provider = databaseRegistry.get(validatedConfig.type);

    if (!provider) {
        // This should never happen after validateConfig, but handle it defensively
        throw new Error(`Provider '${validatedConfig.type}' not found in registry`);
    }

    // Log which provider is being used
    const providerName = provider.metadata?.displayName || validatedConfig.type;
    logger.info(`Using ${providerName} database`);

    // Create and return the database instance (may be async for lazy-loaded dependencies)
    return provider.create(validatedConfig, logger);
}
