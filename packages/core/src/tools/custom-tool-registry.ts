import type { InternalTool } from './types.js';
import type { IDextoLogger } from '../logger/v2/types.js';
import { z } from 'zod';
import { ToolError } from './errors.js';
import { BaseRegistry, type RegistryErrorFactory } from '../providers/base-registry.js';

/**
 * Context passed to custom tool providers when creating tools.
 * Provides optional access to Dexto services for integration.
 */
export interface ToolCreationContext {
    logger: IDextoLogger;
    services?: {
        searchService?: any;
        approvalManager?: any;
        fileSystemService?: any;
        processService?: any;
        resourceManager?: any;
        [key: string]: any; // Extensible for custom providers
    };
}

/**
 * Custom tool provider interface.
 * Allows external code to register tool providers that create one or more tools.
 * Mirrors the BlobStoreProvider pattern for consistency.
 *
 * @template TType - The provider type discriminator (must match config.type)
 * @template TConfig - The provider configuration type (must include { type: TType })
 */
export interface CustomToolProvider<
    TType extends string = string,
    TConfig extends { type: TType } = any,
> {
    /** Unique type identifier matching the discriminator in config */
    type: TType;

    /** Zod schema for runtime validation of provider configuration */
    configSchema: z.ZodType<TConfig, any, any>;

    /**
     * Factory function to create tools from validated configuration
     * @param config - Validated configuration matching configSchema
     * @param context - Tool creation context with logger and optional services
     * @returns Array of tools to register
     */
    create(config: TConfig, context: ToolCreationContext): InternalTool[];

    /** Optional metadata for display and categorization */
    metadata?: {
        displayName: string;
        description: string;
        category?: string;
    };
}

/**
 * Error factory for custom tool registry errors.
 * Uses ToolError for consistent error handling.
 */
const customToolErrorFactory: RegistryErrorFactory = {
    alreadyRegistered: (type: string) => ToolError.customToolProviderAlreadyRegistered(type),
    notFound: (type: string, availableTypes: string[]) =>
        ToolError.unknownCustomToolProvider(type, availableTypes),
};

/**
 * Registry for custom tool providers.
 * Mirrors BlobStoreRegistry pattern for consistency across Dexto provider system.
 *
 * Custom tool providers can be registered from external code (CLI, apps, examples)
 * and are validated at runtime using their Zod schemas.
 *
 * Extends BaseRegistry for common registry functionality.
 */
export class CustomToolRegistry extends BaseRegistry<CustomToolProvider> {
    constructor() {
        super(customToolErrorFactory);
    }
}

/**
 * Global singleton instance of the custom tool registry.
 * Custom tool providers should be registered at application startup.
 */
export const customToolRegistry = new CustomToolRegistry();
