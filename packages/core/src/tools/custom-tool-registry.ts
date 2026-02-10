import type { InternalTool } from './types.js';
import type { IDextoLogger } from '../logger/v2/types.js';
import type { DextoAgent } from '../agent/DextoAgent.js';
import { z } from 'zod';
import { ToolError } from './errors.js';
import { customToolSchemaRegistry } from './custom-tool-schema-registry.js';
import type { ApprovalManager } from '../approval/manager.js';
import type { ResourceManager } from '../resources/manager.js';
import type { SearchService } from '../search/search-service.js';
import type { StorageManager } from '../storage/index.js';

/**
 * TODO: temporary glue code to be removed/verified (remove-by: 5.1)
 *
 * Planned for deletion during the DI refactor. Current importers:
 * - `tools/index.ts` (re-exports)
 * - `tools/tool-manager.ts` (resolves custom tools — temporary glue)
 * - `tools/schemas.ts` (builds config union schema)
 * - Tests: `tools/custom-tool-registry.test.ts`
 */

/**
 * Context passed to custom tool providers when creating tools.
 * Provides access to the agent instance for bidirectional communication.
 *
 * **Bidirectional Services Pattern:**
 * Some services need both:
 * - Agent → Service: LLM calls tools that invoke service methods
 * - Service → Agent: Service emits events that trigger agent invocation
 *
 * Implementation pattern:
 * ```typescript
 * create: (config, context) => {
 *     const service = new MyService(config, context.logger);
 *
 *     // Wire up Service → Agent communication
 *     service.on('event', async (data) => {
 *         await context.agent.sendMessage({
 *             role: 'user',
 *             content: data.prompt,
 *         });
 *     });
 *
 *     // Return Agent → Service tools
 *     return [createMyTool(service)];
 * }
 * ```
 *
 * **Future Consideration:**
 * For complex event routing or decoupled architectures, consider using an Event Bus pattern
 * where services emit events to a central bus and the agent/app subscribes. This would
 * provide better separation of concerns at the cost of more indirection and complexity.
 */
export interface ToolCreationContext {
    logger: IDextoLogger;
    agent: DextoAgent;
    /**
     * Optional services available to custom tool providers.
     *
     * Core services (provided by agent):
     * - approvalManager: For tools that need approval flows
     * - storageManager: For tools that need persistence
     * - resourceManager: For tools that need resource access
     * - searchService: For tools that need search capabilities
     *
     * External tool providers can add their own services using the index signature.
     */
    services?: {
        searchService?: SearchService;
        approvalManager?: ApprovalManager;
        resourceManager?: ResourceManager;
        storageManager?: StorageManager;
        // TODO: temporary glue code to be removed/verified (remove-by: 5.1)
        [key: string]: unknown; // Extensible for external tool providers
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
    TConfig extends { type: TType } = { type: TType } & Record<string, unknown>,
> {
    /** Unique type identifier matching the discriminator in config */
    type: TType;

    /** Zod schema for runtime validation of provider configuration */
    configSchema: z.ZodType<TConfig, z.ZodTypeDef, unknown>;

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
 *
 * When a provider is registered, its config schema is also registered in the
 * customToolSchemaRegistry for early validation at config load time.
 */
export class CustomToolRegistry {
    private providers = new Map<string, CustomToolProvider>();

    /**
     * Register a custom tool provider.
     * Also registers the provider's config schema for early validation.
     *
     * @param provider - The custom tool provider to register
     * @throws Error if a provider with the same type is already registered
     */
    register(provider: CustomToolProvider): void {
        if (this.providers.has(provider.type)) {
            throw ToolError.customToolProviderAlreadyRegistered(provider.type);
        }

        this.providers.set(provider.type, provider);

        // Also register the provider's config schema for early validation
        customToolSchemaRegistry.register(provider.type, provider.configSchema);
    }

    /**
     * Unregister a custom tool provider.
     * Note: This does NOT unregister the schema from customToolSchemaRegistry
     * to avoid breaking active configs that reference the schema.
     *
     * @param type - The provider type to unregister
     * @returns true if the provider was unregistered, false if it wasn't registered
     */
    unregister(type: string): boolean {
        // Only unregister from this registry, not from schema registry
        // Schema registry should persist for the lifetime of the application
        return this.providers.delete(type);
    }

    /**
     * Get a registered provider by type.
     *
     * @param type - The provider type identifier
     * @returns The provider if found, undefined otherwise
     */
    get(type: string): CustomToolProvider | undefined {
        return this.providers.get(type);
    }

    /**
     * Check if a provider is registered.
     *
     * @param type - The provider type identifier
     * @returns true if registered, false otherwise
     */
    has(type: string): boolean {
        return this.providers.has(type);
    }

    /**
     * Get all registered provider types.
     *
     * @returns Array of provider type identifiers
     */
    getTypes(): string[] {
        return Array.from(this.providers.keys());
    }

    /**
     * Clear all registered providers.
     * Primarily useful for testing.
     */
    clear(): void {
        this.providers.clear();
    }

    /**
     * Validate a configuration against a provider's schema.
     *
     * @param config - Raw configuration object with a 'type' field
     * @returns Validated configuration object
     * @throws Error if type is missing, provider not found, or validation fails
     */
    validateConfig(config: unknown): { type: string } & Record<string, unknown> {
        const parsed = z.object({ type: z.string() }).passthrough().parse(config);

        const provider = this.providers.get(parsed.type);
        if (!provider) {
            throw ToolError.unknownCustomToolProvider(parsed.type, this.getTypes());
        }

        return provider.configSchema.parse(config) as { type: string } & Record<string, unknown>;
    }
}

/**
 * Global singleton instance of the custom tool registry.
 * Custom tool providers should be registered at application startup.
 */
export const customToolRegistry = new CustomToolRegistry();
