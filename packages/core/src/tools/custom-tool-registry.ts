import type { InternalTool } from './types.js';
import type { IDextoLogger } from '../logger/v2/types.js';
import { z } from 'zod';

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
 * Registry for custom tool providers.
 * Mirrors BlobStoreRegistry pattern for consistency across Dexto provider system.
 *
 * Custom tool providers can be registered from external code (CLI, apps, examples)
 * and are validated at runtime using their Zod schemas.
 */
export class CustomToolRegistry {
    private providers = new Map<string, CustomToolProvider>();

    /**
     * Register a custom tool provider
     * @param provider - The provider to register
     */
    register<TType extends string, TConfig extends { type: TType }>(
        provider: CustomToolProvider<TType, TConfig>
    ): void {
        if (this.providers.has(provider.type)) {
            throw new Error(
                `Custom tool provider '${provider.type}' is already registered. ` +
                    `Use unregister() first if you want to replace it.`
            );
        }
        this.providers.set(provider.type, provider as CustomToolProvider);
    }

    /**
     * Get a provider by type
     * @param type - Provider type identifier
     * @returns Provider or undefined if not found
     */
    get(type: string): CustomToolProvider | undefined {
        return this.providers.get(type);
    }

    /**
     * Check if a provider is registered
     * @param type - Provider type identifier
     * @returns True if provider is registered
     */
    has(type: string): boolean {
        return this.providers.has(type);
    }

    /**
     * Get all registered provider types
     * @returns Array of provider type identifiers
     */
    getTypes(): string[] {
        return Array.from(this.providers.keys());
    }

    /**
     * Validate configuration against the registered provider's schema
     * @param config - Configuration object with 'type' field
     * @returns Validated configuration
     * @throws Error if provider not found or validation fails
     */
    validateConfig(config: unknown): any {
        // First validate basic structure (must have 'type' field)
        const typeSchema = z.object({ type: z.string() }).passthrough();
        const parsed = typeSchema.parse(config);

        // Look up provider by type
        const provider = this.providers.get(parsed.type);
        if (!provider) {
            const available = this.getTypes();
            throw new Error(
                `Unknown custom tool provider: '${parsed.type}'. ` +
                    `Available types: ${available.length > 0 ? available.join(', ') : 'none'}`
            );
        }

        // Validate against provider's schema
        return provider.configSchema.parse(config);
    }

    /**
     * Unregister a provider
     * @param type - Provider type identifier
     * @returns True if provider was unregistered, false if not found
     */
    unregister(type: string): boolean {
        return this.providers.delete(type);
    }

    /**
     * Clear all registered providers.
     * Primarily useful for testing.
     */
    clear(): void {
        this.providers.clear();
    }
}

/**
 * Global singleton instance of the custom tool registry.
 * Custom tool providers should be registered at application startup.
 */
export const customToolRegistry = new CustomToolRegistry();
