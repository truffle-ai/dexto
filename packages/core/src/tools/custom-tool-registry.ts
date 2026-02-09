import type { InternalTool } from './types.js';
import type { IDextoLogger } from '../logger/v2/types.js';
import type { DextoAgent } from '../agent/DextoAgent.js';
import type { z } from 'zod';
import { ToolError } from './errors.js';
import { BaseRegistry, type RegistryErrorFactory } from '../providers/base-registry.js';
import { customToolSchemaRegistry } from './custom-tool-schema-registry.js';
import type { ApprovalManager } from '../approval/manager.js';
import type { ResourceManager } from '../resources/manager.js';
import type { SearchService } from '../search/search-service.js';
import type { StorageManager } from '../storage/index.js';

/**
 * TODO: temporary glue code to be removed/verified
 *
 * Planned for deletion during the DI refactor (see PLAN task 1.10). Current importers:
 * - `tools/index.ts` (re-exports)
 * - `tools/tool-manager.ts` (resolves custom tools — temporary glue)
 * - `tools/schemas.ts` (builds config union schema)
 * - `providers/discovery.ts` (provider listing)
 * - Tests: `tools/custom-tool-registry.test.ts`, `providers/discovery.test.ts`
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
        // TODO: temporary glue code to be removed/verified
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
 *
 * When a provider is registered, its config schema is also registered in the
 * customToolSchemaRegistry for early validation at config load time.
 */
export class CustomToolRegistry extends BaseRegistry<CustomToolProvider> {
    constructor() {
        super(customToolErrorFactory);
    }

    /**
     * Register a custom tool provider.
     * Also registers the provider's config schema for early validation.
     *
     * @param provider - The custom tool provider to register
     * @throws Error if a provider with the same type is already registered
     */
    override register(provider: CustomToolProvider): void {
        // Register the provider with the base registry
        super.register(provider);

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
    override unregister(type: string): boolean {
        // Only unregister from this registry, not from schema registry
        // Schema registry should persist for the lifetime of the application
        return super.unregister(type);
    }
}

/**
 * Global singleton instance of the custom tool registry.
 * Custom tool providers should be registered at application startup.
 */
export const customToolRegistry = new CustomToolRegistry();
