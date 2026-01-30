import { z } from 'zod';
import type { DextoPlugin } from './types.js';
import { DextoRuntimeError, ErrorScope, ErrorType } from '../errors/index.js';
import { PluginErrorCode } from './error-codes.js';
import { BaseRegistry, type RegistryErrorFactory } from '../providers/base-registry.js';

/**
 * Context passed to plugin providers when creating plugin instances.
 * Provides access to configuration and optional services.
 */
export interface PluginCreationContext {
    /** Plugin-specific configuration from YAML */
    config: Record<string, any>;
    /** Whether this plugin should block execution on errors */
    blocking: boolean;
    /** Execution priority (lower runs first) */
    priority: number;
}

/**
 * Plugin provider interface.
 * Allows external code to register plugin providers that create plugin instances.
 * Follows the same pattern as BlobStoreProvider, CompressionProvider, and CustomToolProvider.
 *
 * @template TType - The provider type discriminator (must match config.type)
 * @template TConfig - The provider configuration type (must include { type: TType })
 */
export interface PluginProvider<
    TType extends string = string,
    TConfig extends { type: TType } = any,
> {
    /** Unique type identifier matching the discriminator in config */
    type: TType;

    /** Zod schema for runtime validation of provider configuration */
    configSchema: z.ZodType<TConfig, any, any>;

    /**
     * Factory function to create a plugin instance from validated configuration
     * @param config - Validated configuration matching configSchema
     * @param context - Plugin creation context with priority and blocking settings
     * @returns A DextoPlugin instance
     */
    create(config: TConfig, context: PluginCreationContext): DextoPlugin;

    /** Optional metadata for display and categorization */
    metadata?: {
        displayName: string;
        description: string;
        /** Which extension points this plugin implements */
        extensionPoints?: Array<
            'beforeLLMRequest' | 'beforeToolCall' | 'afterToolResult' | 'beforeResponse'
        >;
        /** Category for grouping (e.g., 'security', 'logging', 'integration') */
        category?: string;
    };
}

/**
 * Error factory for plugin registry errors.
 * Uses PluginErrorCode for consistent error handling.
 */
const pluginRegistryErrorFactory: RegistryErrorFactory = {
    alreadyRegistered: (type: string) =>
        new DextoRuntimeError(
            PluginErrorCode.PLUGIN_PROVIDER_ALREADY_REGISTERED,
            ErrorScope.PLUGIN,
            ErrorType.USER,
            `Plugin provider '${type}' is already registered`,
            { type },
            'Each plugin provider type can only be registered once'
        ),
    notFound: (type: string, availableTypes: string[]) =>
        new DextoRuntimeError(
            PluginErrorCode.PLUGIN_PROVIDER_NOT_FOUND,
            ErrorScope.PLUGIN,
            ErrorType.USER,
            `Plugin provider '${type}' not found`,
            { type, available: availableTypes },
            `Available plugin providers: ${availableTypes.join(', ') || 'none'}`
        ),
};

/**
 * Registry for plugin providers.
 * Follows the same pattern as BlobStoreRegistry, CompressionRegistry, and CustomToolRegistry.
 *
 * Plugin providers can be registered from external code (CLI, apps, distributions)
 * and are validated at runtime using their Zod schemas.
 *
 * Extends BaseRegistry for common registry functionality.
 *
 * @example
 * ```typescript
 * // Define a plugin provider
 * const myPluginProvider: PluginProvider<'my-plugin', MyPluginConfig> = {
 *     type: 'my-plugin',
 *     configSchema: MyPluginConfigSchema,
 *     create(config, context) {
 *         return new MyPlugin(config, context);
 *     },
 *     metadata: {
 *         displayName: 'My Plugin',
 *         description: 'Does something useful',
 *         extensionPoints: ['beforeLLMRequest'],
 *         category: 'custom',
 *     },
 * };
 *
 * // Register in dexto.config.ts
 * import { pluginRegistry } from '@dexto/core';
 * pluginRegistry.register(myPluginProvider);
 *
 * // Use in agent YAML
 * plugins:
 *   registry:
 *     - type: my-plugin
 *       priority: 50
 *       blocking: false
 *       config:
 *         key: value
 * ```
 */
export class PluginRegistry extends BaseRegistry<PluginProvider> {
    constructor() {
        super(pluginRegistryErrorFactory);
    }

    /**
     * Get all registered plugin providers.
     * Alias for getAll() to match other registry patterns.
     */
    getProviders(): PluginProvider[] {
        return this.getAll();
    }
}

/**
 * Global singleton instance of the plugin registry.
 * Plugin providers should be registered at application startup.
 */
export const pluginRegistry = new PluginRegistry();
