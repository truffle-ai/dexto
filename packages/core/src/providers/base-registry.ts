import { z } from 'zod';

/**
 * Base provider interface - all providers must have a type identifier.
 */
export interface BaseProvider {
    /** Unique type identifier for this provider */
    type: string;
}

/**
 * Provider with config schema - for providers that support validateConfig.
 */
export interface ConfigurableProvider extends BaseProvider {
    /** Zod schema for validating provider configuration */
    configSchema: z.ZodType<any, any, any>;
}

/**
 * Error factory interface for customizing registry errors.
 * Each registry can provide its own error implementations.
 */
export interface RegistryErrorFactory {
    /** Called when attempting to register a provider that already exists */
    alreadyRegistered(type: string): Error;
    /** Called when looking up a provider that doesn't exist (for validateConfig) */
    notFound(type: string, availableTypes: string[]): Error;
}

/**
 * Default error factory that throws plain Error instances.
 * Used when no custom error factory is provided.
 */
export const defaultErrorFactory: RegistryErrorFactory = {
    alreadyRegistered: (type: string) => new Error(`Provider '${type}' is already registered`),
    notFound: (type: string, availableTypes: string[]) =>
        new Error(
            `Provider '${type}' not found. Available: ${availableTypes.join(', ') || 'none'}`
        ),
};

/**
 * Generic base registry for provider patterns.
 *
 * This class provides common registry functionality used across Dexto's
 * provider system (blob storage, compression, custom tools, etc.).
 *
 * Features:
 * - Type-safe provider registration and retrieval
 * - Duplicate registration prevention
 * - Customizable error handling via error factory
 * - Optional config validation for providers with schemas
 *
 * @template TProvider - The provider type (must extend BaseProvider)
 *
 * @example
 * ```typescript
 * // Define your provider interface
 * interface MyProvider extends BaseProvider {
 *   type: string;
 *   configSchema: z.ZodType<any>;
 *   create(config: any): MyInstance;
 * }
 *
 * // Create a registry
 * class MyRegistry extends BaseRegistry<MyProvider> {
 *   constructor() {
 *     super({
 *       alreadyRegistered: (type) => new MyError(`Provider ${type} exists`),
 *       notFound: (type, available) => new MyError(`Unknown: ${type}`),
 *     });
 *   }
 * }
 *
 * // Use the registry
 * const registry = new MyRegistry();
 * registry.register(myProvider);
 * const provider = registry.get('my-type');
 * ```
 */
export class BaseRegistry<TProvider extends BaseProvider> {
    protected providers = new Map<string, TProvider>();
    protected errorFactory: RegistryErrorFactory;

    /**
     * Create a new registry instance.
     *
     * @param errorFactory - Optional custom error factory for registry errors.
     *                       If not provided, uses default Error instances.
     */
    constructor(errorFactory: RegistryErrorFactory = defaultErrorFactory) {
        this.errorFactory = errorFactory;
    }

    /**
     * Register a provider.
     *
     * @param provider - The provider to register
     * @throws Error if a provider with the same type is already registered
     */
    register(provider: TProvider): void {
        if (this.providers.has(provider.type)) {
            throw this.errorFactory.alreadyRegistered(provider.type);
        }
        this.providers.set(provider.type, provider);
    }

    /**
     * Unregister a provider.
     *
     * @param type - The provider type to unregister
     * @returns true if the provider was unregistered, false if it wasn't registered
     */
    unregister(type: string): boolean {
        return this.providers.delete(type);
    }

    /**
     * Get a registered provider by type.
     *
     * @param type - The provider type identifier
     * @returns The provider if found, undefined otherwise
     */
    get(type: string): TProvider | undefined {
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
     * Get all registered providers.
     *
     * @returns Array of providers
     */
    getAll(): TProvider[] {
        return Array.from(this.providers.values());
    }

    /**
     * Get the number of registered providers.
     *
     * @returns Count of registered providers
     */
    get size(): number {
        return this.providers.size;
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
     * This method is only available for registries with providers that have
     * a configSchema property. It:
     * 1. Extracts the 'type' field to identify the provider
     * 2. Looks up the provider in the registry
     * 3. Validates the full config against the provider's schema
     * 4. Returns the validated configuration
     *
     * @param config - Raw configuration object with a 'type' field
     * @returns Validated configuration object
     * @throws Error if type is missing, provider not found, or validation fails
     */
    validateConfig(config: unknown): any {
        // First, validate that we have a type field
        const typeSchema = z.object({ type: z.string() }).passthrough();
        const parsed = typeSchema.parse(config);

        // Look up the provider
        const provider = this.providers.get(parsed.type);
        if (!provider) {
            throw this.errorFactory.notFound(parsed.type, this.getTypes());
        }

        // Check if provider has configSchema
        if (!('configSchema' in provider) || !provider.configSchema) {
            throw new Error(
                `Provider '${parsed.type}' does not support config validation (no configSchema)`
            );
        }

        // Validate against provider schema
        return (provider as ConfigurableProvider).configSchema.parse(config);
    }
}
