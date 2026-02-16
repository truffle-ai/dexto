import type { Database } from './types.js';
import type { Logger } from '@dexto/core';
import type { z } from 'zod';

/**
 * Factory interface for creating database instances.
 *
 * Factories are plain exports (no global registries). Images decide which factories are
 * available by including them in `image.storage.database`.
 */
export interface DatabaseFactory<TConfig = unknown> {
    /**
     * Zod schema for validating factory-specific configuration.
     * The schema must output the `TConfig` type.
     */
    configSchema: z.ZodType<TConfig, z.ZodTypeDef, unknown>;

    /**
     * Factory function to create a Database instance.
     *
     * Database factories may return a Promise to support lazy loading of optional
     * dependencies (e.g., `better-sqlite3`, `pg`).
     *
     * @param config - Validated configuration specific to this backend
     * @param logger - Logger instance for the database
     * @returns A Database implementation (or Promise for async backends)
     */
    create(config: TConfig, logger: Logger): Database | Promise<Database>;

    /**
     * Optional metadata for documentation, UIs, and discovery.
     */
    metadata?: {
        /** Human-readable name (e.g., "SQLite", "PostgreSQL") */
        displayName: string;
        /** Brief description of this storage backend */
        description: string;
        /** Whether this backend requires network connectivity */
        requiresNetwork?: boolean;
        /** Whether this backend supports list operations (append/getRange) */
        supportsListOperations?: boolean;
    };
}
