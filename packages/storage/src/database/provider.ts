import type { z } from 'zod';
import type { Database } from './types.js';
import type { IDextoLogger } from '@dexto/core';

/**
 * Provider interface for creating database instances.
 *
 * This interface uses TypeScript generics to enforce type safety:
 * - TType: The literal type string (e.g., 'sqlite', 'postgres')
 * - TConfig: The configuration type with discriminator { type: TType }
 *
 * This ensures that the provider type matches the config type discriminator,
 * providing compile-time safety for provider implementations.
 */
export interface DatabaseProvider<
    TType extends string = string,
    TConfig extends { type: TType } = any,
> {
    /**
     * Unique identifier for this provider (e.g., 'sqlite', 'postgres', 'in-memory').
     * Must match the 'type' field in the configuration.
     */
    type: TType;

    /**
     * Zod schema for validating provider-specific configuration.
     * The schema must output TConfig type.
     *
     * Note: Uses z.ZodType with relaxed generics to allow input/output type variance.
     * This is necessary because Zod schemas with `.optional().default()` have
     * input types that include undefined, but output types that don't.
     */
    configSchema: z.ZodType<TConfig, any, any>;

    /**
     * Factory function to create a Database instance.
     *
     * Unlike blob store providers (which are sync), database providers may return
     * a Promise to support lazy loading of optional dependencies (e.g., better-sqlite3, pg).
     *
     * @param config - Validated configuration specific to this provider
     * @param logger - Logger instance for the database
     * @returns A Database implementation (or Promise for async providers)
     */
    create(config: TConfig, logger: IDextoLogger): Database | Promise<Database>;

    /**
     * Optional metadata for documentation, UIs, and discovery.
     */
    metadata?: {
        /** Human-readable name (e.g., "SQLite", "PostgreSQL") */
        displayName: string;
        /** Brief description of this storage backend */
        description: string;
        /** Whether this provider requires network connectivity */
        requiresNetwork?: boolean;
        /** Whether this provider supports list operations (append/getRange) */
        supportsListOperations?: boolean;
    };
}
