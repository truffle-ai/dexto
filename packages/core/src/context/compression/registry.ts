import type { CompressionProvider, CompressionConfig } from './provider.js';

/**
 * Global registry for compression providers.
 *
 * Follows the same pattern as blob storage and tools registries:
 * - Singleton instance exported
 * - Registration before agent initialization
 * - Type-safe provider lookup
 */
class CompressionRegistry {
    private providers = new Map<string, CompressionProvider<any, any>>();

    /**
     * Register a compression provider
     */
    register<TType extends string, TConfig extends CompressionConfig>(
        provider: CompressionProvider<TType, TConfig>
    ): void {
        if (this.providers.has(provider.type)) {
            throw new Error(`Compression provider '${provider.type}' is already registered`);
        }
        this.providers.set(provider.type, provider);
    }

    /**
     * Get a provider by type
     */
    get(type: string): CompressionProvider<any, any> | undefined {
        return this.providers.get(type);
    }

    /**
     * Check if a provider is registered
     */
    has(type: string): boolean {
        return this.providers.has(type);
    }

    /**
     * Get all registered provider types
     */
    getTypes(): string[] {
        return Array.from(this.providers.keys());
    }

    /**
     * Get all providers
     */
    getAll(): CompressionProvider<any, any>[] {
        return Array.from(this.providers.values());
    }

    /**
     * Clear all providers (useful for testing)
     */
    clear(): void {
        this.providers.clear();
    }
}

/** Global singleton instance */
export const compressionRegistry = new CompressionRegistry();
