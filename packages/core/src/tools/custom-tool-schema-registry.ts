/**
 * Custom Tool Schema Registry
 *
 * Registry for custom tool provider configuration schemas.
 * Allows core to validate provider-specific fields at config load time
 * by building a discriminated union of all registered schemas.
 *
 * Architecture:
 * 1. Providers register their config schemas when they register with customToolRegistry
 * 2. Core uses this registry to build a discriminated union schema at runtime
 * 3. Agent config validation uses the union to validate provider-specific fields early
 *
 * Benefits:
 * - Early validation (at config load time, not runtime)
 * - Type safety (full Zod validation for all provider fields)
 * - IDE support (TypeScript knows all provider fields)
 * - Single source of truth (provider schema defines everything)
 */

/**
 * TODO: temporary glue code to be removed/verified
 *
 * This registry exists only to support early custom-tool config validation while core still owns
 * config parsing. It is planned for deletion once tool resolution moves to `@dexto/agent-config`.
 */

import { z } from 'zod';
import type { IDextoLogger } from '../logger/v2/types.js';
import { DextoLogComponent } from '../logger/v2/types.js';

/**
 * Registry for custom tool provider configuration schemas.
 *
 * Providers register their config schemas here, allowing core to validate
 * provider-specific configuration fields at config load time.
 *
 * Note: This is a lightweight registry that doesn't extend BaseRegistry
 * to avoid complexity. It simply stores schemas in a Map.
 */
// Create a no-op logger for when logger is not available
const createNoOpLogger = (): IDextoLogger => {
    const noOpLogger: IDextoLogger = {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        silly: () => {},
        trackException: () => {},
        setLevel: () => {},
        getLevel: () => 'info',
        getLogFilePath: () => null,
        destroy: () => Promise.resolve(),
        createChild: () => noOpLogger,
    };
    return noOpLogger;
};

class CustomToolSchemaRegistry {
    private schemas = new Map<string, z.ZodType<any>>();
    private logger: IDextoLogger;

    constructor(logger: IDextoLogger) {
        this.logger = logger;
    }

    /**
     * Register a provider's config schema.
     * Called automatically when a custom tool provider is registered.
     *
     * @param type Provider type (must match the 'type' field in config)
     * @param schema Zod schema for the provider's configuration
     *
     * @throws Error if schema is already registered for this type
     */
    register<T extends z.ZodType<any>>(type: string, schema: T): void {
        if (this.schemas.has(type)) {
            throw new Error(`Config schema already registered for provider type: ${type}`);
        }
        this.schemas.set(type, schema);
        this.logger.debug(`Registered config schema for provider: ${type}`);
    }

    /**
     * Get a provider's config schema.
     *
     * @param type Provider type
     * @returns The registered schema, or undefined if not found
     */
    get(type: string): z.ZodType<any> | undefined {
        return this.schemas.get(type);
    }

    /**
     * Check if a provider type has a registered schema.
     *
     * @param type Provider type
     * @returns true if schema is registered
     */
    has(type: string): boolean {
        return this.schemas.has(type);
    }

    /**
     * Get all registered provider types.
     *
     * @returns Array of provider type strings
     */
    getRegisteredTypes(): string[] {
        return Array.from(this.schemas.keys());
    }

    /**
     * Create a discriminated union schema for all registered providers.
     * This enables early validation of provider-specific fields at config load time.
     *
     * The union is discriminated by the 'type' field, which provides better error
     * messages when validation fails.
     *
     * @returns Discriminated union schema if providers are registered,
     *          passthrough schema otherwise (for backward compatibility)
     */
    createUnionSchema(): z.ZodType<any> {
        const types = this.getRegisteredTypes();

        if (types.length === 0) {
            // No providers registered - use base passthrough schema for backward compatibility
            // This allows configs to be loaded before providers are registered
            this.logger.debug(
                'No provider schemas registered - using passthrough schema for custom tools'
            );
            return z
                .object({
                    type: z.string().describe('Custom tool provider type'),
                })
                .passthrough()
                .describe(
                    'Custom tool provider configuration (no schemas registered - validation deferred to runtime)'
                );
        }

        // Get all registered schemas - guaranteed to exist since we check types.length > 0
        const schemas: z.ZodType<any>[] = [];
        for (const type of types) {
            const schema = this.get(type);
            if (schema) {
                schemas.push(schema);
            }
        }

        if (schemas.length === 0) {
            // Shouldn't happen, but handle gracefully
            this.logger.warn('No schemas found despite having registered types');
            return z
                .object({
                    type: z.string(),
                })
                .passthrough();
        }

        if (schemas.length === 1) {
            // Single provider - just return its schema
            // Type assertion is safe because we just pushed it and checked length > 0
            this.logger.debug(`Using single provider schema: ${types[0]}`);
            return schemas[0]!;
        }

        // Multiple providers - create regular union (discriminated union requires specific schema types)
        this.logger.debug(
            `Creating union schema for ${schemas.length} providers: ${types.join(', ')}`
        );

        // Cast to tuple type required by z.union
        return z.union(schemas as [z.ZodType<any>, z.ZodType<any>, ...z.ZodType<any>[]]);
    }

    /**
     * Clear all registered schemas.
     * Primarily used for testing.
     */
    clear(): void {
        this.schemas.clear();
        this.logger.debug('Cleared all registered provider schemas');
    }
}

// Global singleton instance
// Uses DextoLogComponent.TOOLS for logging
let globalInstance: CustomToolSchemaRegistry | undefined;

/**
 * Get the global custom tool schema registry instance.
 * Creates it on first access with the provided logger.
 *
 * @param logger Optional logger for the registry (only used on first access)
 * @returns The global registry instance
 */
export function getCustomToolSchemaRegistry(logger?: IDextoLogger): CustomToolSchemaRegistry {
    if (!globalInstance) {
        const registryLogger = logger
            ? logger.createChild(DextoLogComponent.TOOLS)
            : createNoOpLogger();
        globalInstance = new CustomToolSchemaRegistry(registryLogger);
    }
    return globalInstance;
}

/**
 * Global custom tool schema registry instance.
 * Use this for registering and retrieving provider config schemas.
 */
export const customToolSchemaRegistry = getCustomToolSchemaRegistry();
