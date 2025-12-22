import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { compressionRegistry } from './registry.js';
import type { CompressionProvider, CompressionConfig, CompressionContext } from './provider.js';
import type { ICompressionStrategy } from './types.js';
import type { InternalMessage } from '../types.js';

// Mock compression config types
interface MockCompressionConfig extends CompressionConfig {
    type: 'mock';
    enabled?: boolean;
    maxTokens?: number;
}

interface AnotherMockConfig extends CompressionConfig {
    type: 'another-mock';
    enabled?: boolean;
    threshold?: number;
}

// Mock compression strategy implementation
class MockCompressionStrategy implements ICompressionStrategy {
    readonly name = 'mock-compression';

    constructor(private config: MockCompressionConfig) {}

    async compress(history: readonly InternalMessage[]): Promise<InternalMessage[]> {
        return history.slice(0, this.config.maxTokens || 100) as InternalMessage[];
    }
}

class AnotherMockStrategy implements ICompressionStrategy {
    readonly name = 'another-mock-compression';

    constructor(private config: AnotherMockConfig) {}

    async compress(history: readonly InternalMessage[]): Promise<InternalMessage[]> {
        return history.slice(0, this.config.threshold || 50) as InternalMessage[];
    }
}

// Mock compression providers
const mockProvider: CompressionProvider<'mock', MockCompressionConfig> = {
    type: 'mock',
    configSchema: z.object({
        type: z.literal('mock'),
        enabled: z.boolean().default(true),
        maxTokens: z.number().default(100),
    }),
    metadata: {
        displayName: 'Mock Compression',
        description: 'A mock compression strategy for testing',
        requiresLLM: false,
        isProactive: true,
    },
    create(config: MockCompressionConfig, _context: CompressionContext): ICompressionStrategy {
        return new MockCompressionStrategy(config);
    },
};

const anotherMockProvider: CompressionProvider<'another-mock', AnotherMockConfig> = {
    type: 'another-mock',
    configSchema: z.object({
        type: z.literal('another-mock'),
        enabled: z.boolean().default(true),
        threshold: z.number().default(50),
    }),
    metadata: {
        displayName: 'Another Mock Compression',
        description: 'Another mock compression strategy for testing',
        requiresLLM: true,
        isProactive: false,
    },
    create(config: AnotherMockConfig, _context: CompressionContext): ICompressionStrategy {
        return new AnotherMockStrategy(config);
    },
};

const minimalProvider: CompressionProvider<'minimal', CompressionConfig> = {
    type: 'minimal',
    configSchema: z.object({
        type: z.literal('minimal'),
        enabled: z.boolean().default(true),
    }),
    create(_config: CompressionConfig, _context: CompressionContext): ICompressionStrategy {
        return {
            name: 'minimal-compression',
            compress: async (history: readonly InternalMessage[]) =>
                history.slice() as InternalMessage[],
        };
    },
};

describe('CompressionRegistry', () => {
    beforeEach(() => {
        // Clear registry before each test to ensure isolation
        compressionRegistry.clear();
    });

    describe('register()', () => {
        it('successfully registers a provider', () => {
            expect(() => compressionRegistry.register(mockProvider)).not.toThrow();
            expect(compressionRegistry.has('mock')).toBe(true);
        });

        it('successfully registers multiple providers', () => {
            compressionRegistry.register(mockProvider);
            compressionRegistry.register(anotherMockProvider);

            expect(compressionRegistry.has('mock')).toBe(true);
            expect(compressionRegistry.has('another-mock')).toBe(true);
        });

        it('throws error when registering duplicate provider', () => {
            compressionRegistry.register(mockProvider);

            expect(() => compressionRegistry.register(mockProvider)).toThrow(
                "Compression provider 'mock' is already registered"
            );
        });

        it('allows re-registration after unregistering', () => {
            compressionRegistry.register(mockProvider);
            compressionRegistry.unregister('mock');

            expect(() => compressionRegistry.register(mockProvider)).not.toThrow();
            expect(compressionRegistry.has('mock')).toBe(true);
        });

        it('registers provider with minimal metadata', () => {
            compressionRegistry.register(minimalProvider);

            const provider = compressionRegistry.get('minimal');
            expect(provider).toBeDefined();
            expect(provider?.type).toBe('minimal');
            expect(provider?.metadata).toBeUndefined();
        });
    });

    describe('unregister()', () => {
        it('successfully unregisters an existing provider', () => {
            compressionRegistry.register(mockProvider);

            const result = compressionRegistry.unregister('mock');

            expect(result).toBe(true);
            expect(compressionRegistry.has('mock')).toBe(false);
        });

        it('returns false when unregistering non-existent provider', () => {
            const result = compressionRegistry.unregister('non-existent');

            expect(result).toBe(false);
        });

        it('returns false when unregistering from empty registry', () => {
            const result = compressionRegistry.unregister('mock');

            expect(result).toBe(false);
        });

        it('can unregister one provider while keeping others', () => {
            compressionRegistry.register(mockProvider);
            compressionRegistry.register(anotherMockProvider);

            const result = compressionRegistry.unregister('mock');

            expect(result).toBe(true);
            expect(compressionRegistry.has('mock')).toBe(false);
            expect(compressionRegistry.has('another-mock')).toBe(true);
        });
    });

    describe('get()', () => {
        it('returns registered provider', () => {
            compressionRegistry.register(mockProvider);

            const provider = compressionRegistry.get('mock');

            expect(provider).toBeDefined();
            expect(provider?.type).toBe('mock');
            expect(provider?.metadata?.displayName).toBe('Mock Compression');
        });

        it('returns undefined for non-existent provider', () => {
            const provider = compressionRegistry.get('non-existent');

            expect(provider).toBeUndefined();
        });

        it('returns undefined from empty registry', () => {
            const provider = compressionRegistry.get('mock');

            expect(provider).toBeUndefined();
        });

        it('returns correct provider when multiple are registered', () => {
            compressionRegistry.register(mockProvider);
            compressionRegistry.register(anotherMockProvider);

            const provider1 = compressionRegistry.get('mock');
            const provider2 = compressionRegistry.get('another-mock');

            expect(provider1?.type).toBe('mock');
            expect(provider2?.type).toBe('another-mock');
        });

        it('returns full provider interface including create function', () => {
            compressionRegistry.register(mockProvider);

            const provider = compressionRegistry.get('mock');

            expect(provider).toBeDefined();
            expect(typeof provider?.create).toBe('function');
            expect(provider?.configSchema).toBeDefined();
        });
    });

    describe('has()', () => {
        it('returns true for registered provider', () => {
            compressionRegistry.register(mockProvider);

            expect(compressionRegistry.has('mock')).toBe(true);
        });

        it('returns false for non-existent provider', () => {
            expect(compressionRegistry.has('non-existent')).toBe(false);
        });

        it('returns false from empty registry', () => {
            expect(compressionRegistry.has('mock')).toBe(false);
        });

        it('returns false after unregistering', () => {
            compressionRegistry.register(mockProvider);
            compressionRegistry.unregister('mock');

            expect(compressionRegistry.has('mock')).toBe(false);
        });

        it('correctly identifies multiple registered providers', () => {
            compressionRegistry.register(mockProvider);
            compressionRegistry.register(anotherMockProvider);

            expect(compressionRegistry.has('mock')).toBe(true);
            expect(compressionRegistry.has('another-mock')).toBe(true);
            expect(compressionRegistry.has('non-existent')).toBe(false);
        });
    });

    describe('getTypes()', () => {
        it('returns all registered provider types', () => {
            compressionRegistry.register(mockProvider);
            compressionRegistry.register(anotherMockProvider);

            const types = compressionRegistry.getTypes();

            expect(types).toHaveLength(2);
            expect(types).toContain('mock');
            expect(types).toContain('another-mock');
        });

        it('returns empty array for empty registry', () => {
            const types = compressionRegistry.getTypes();

            expect(types).toEqual([]);
        });

        it('returns single type when only one provider is registered', () => {
            compressionRegistry.register(mockProvider);

            const types = compressionRegistry.getTypes();

            expect(types).toEqual(['mock']);
        });

        it('updates after unregistering a provider', () => {
            compressionRegistry.register(mockProvider);
            compressionRegistry.register(anotherMockProvider);
            compressionRegistry.unregister('mock');

            const types = compressionRegistry.getTypes();

            expect(types).toHaveLength(1);
            expect(types).toContain('another-mock');
            expect(types).not.toContain('mock');
        });

        it('returns array that can be iterated', () => {
            compressionRegistry.register(mockProvider);
            compressionRegistry.register(anotherMockProvider);

            const types = compressionRegistry.getTypes();
            const typeArray: string[] = [];

            types.forEach((type) => {
                expect(typeof type).toBe('string');
                typeArray.push(type);
            });

            expect(typeArray.length).toBe(2);
        });
    });

    describe('getAll()', () => {
        it('returns all registered providers', () => {
            compressionRegistry.register(mockProvider);
            compressionRegistry.register(anotherMockProvider);

            const providers = compressionRegistry.getAll();

            expect(providers).toHaveLength(2);
            expect(providers[0]!.type).toBe('mock');
            expect(providers[1]!.type).toBe('another-mock');
        });

        it('returns empty array for empty registry', () => {
            const providers = compressionRegistry.getAll();

            expect(providers).toEqual([]);
        });

        it('returns single provider when only one is registered', () => {
            compressionRegistry.register(mockProvider);

            const providers = compressionRegistry.getAll();

            expect(providers).toHaveLength(1);
            expect(providers[0]!.type).toBe('mock');
        });

        it('updates after unregistering a provider', () => {
            compressionRegistry.register(mockProvider);
            compressionRegistry.register(anotherMockProvider);
            compressionRegistry.unregister('mock');

            const providers = compressionRegistry.getAll();

            expect(providers).toHaveLength(1);
            expect(providers[0]!.type).toBe('another-mock');
        });

        it('returns providers with full interface including metadata', () => {
            compressionRegistry.register(mockProvider);
            compressionRegistry.register(anotherMockProvider);

            const providers = compressionRegistry.getAll();

            expect(providers[0]!.metadata).toBeDefined();
            expect(providers[0]!.metadata?.displayName).toBe('Mock Compression');
            expect(providers[1]!.metadata).toBeDefined();
            expect(providers[1]!.metadata?.requiresLLM).toBe(true);
        });

        it('returns array that can be filtered and mapped', () => {
            compressionRegistry.register(mockProvider);
            compressionRegistry.register(anotherMockProvider);
            compressionRegistry.register(minimalProvider);

            const providers = compressionRegistry.getAll();
            const providersWithLLM = providers.filter((p) => p.metadata?.requiresLLM === true);
            const providerTypes = providers.map((p) => p.type);

            expect(providersWithLLM).toHaveLength(1);
            expect(providersWithLLM[0]!.type).toBe('another-mock');
            expect(providerTypes).toEqual(['mock', 'another-mock', 'minimal']);
        });
    });

    describe('clear()', () => {
        it('clears all registered providers', () => {
            compressionRegistry.register(mockProvider);
            compressionRegistry.register(anotherMockProvider);

            compressionRegistry.clear();

            expect(compressionRegistry.getTypes()).toEqual([]);
            expect(compressionRegistry.getAll()).toEqual([]);
            expect(compressionRegistry.has('mock')).toBe(false);
            expect(compressionRegistry.has('another-mock')).toBe(false);
        });

        it('can clear empty registry without errors', () => {
            expect(() => compressionRegistry.clear()).not.toThrow();

            expect(compressionRegistry.getTypes()).toEqual([]);
        });

        it('allows re-registration after clearing', () => {
            compressionRegistry.register(mockProvider);
            compressionRegistry.clear();

            expect(() => compressionRegistry.register(mockProvider)).not.toThrow();
            expect(compressionRegistry.has('mock')).toBe(true);
        });

        it('truly removes all providers including their state', () => {
            compressionRegistry.register(mockProvider);
            compressionRegistry.register(anotherMockProvider);
            compressionRegistry.register(minimalProvider);

            compressionRegistry.clear();

            expect(compressionRegistry.get('mock')).toBeUndefined();
            expect(compressionRegistry.get('another-mock')).toBeUndefined();
            expect(compressionRegistry.get('minimal')).toBeUndefined();
            expect(compressionRegistry.getAll().length).toBe(0);
        });
    });

    describe('Integration scenarios', () => {
        it('supports complete provider lifecycle', () => {
            // Register
            compressionRegistry.register(mockProvider);
            expect(compressionRegistry.has('mock')).toBe(true);

            // Get and verify
            const provider = compressionRegistry.get('mock');
            expect(provider?.type).toBe('mock');

            // Use provider
            expect(typeof provider?.create).toBe('function');

            // Unregister
            const unregistered = compressionRegistry.unregister('mock');
            expect(unregistered).toBe(true);
            expect(compressionRegistry.has('mock')).toBe(false);
        });

        it('handles multiple provider types with different configurations', () => {
            compressionRegistry.register(mockProvider);
            compressionRegistry.register(anotherMockProvider);
            compressionRegistry.register(minimalProvider);

            const types = compressionRegistry.getTypes();
            expect(types).toHaveLength(3);

            const withMetadata = compressionRegistry
                .getAll()
                .filter((p) => p.metadata !== undefined);
            expect(withMetadata).toHaveLength(2);

            const requiresLLM = compressionRegistry
                .getAll()
                .filter((p) => p.metadata?.requiresLLM === true);
            expect(requiresLLM).toHaveLength(1);
            expect(requiresLLM[0]!.type).toBe('another-mock');
        });

        it('maintains provider isolation between operations', () => {
            compressionRegistry.register(mockProvider);

            const provider1 = compressionRegistry.get('mock');
            const provider2 = compressionRegistry.get('mock');

            // Both should return the same provider instance
            expect(provider1).toBe(provider2);

            // Unregistering should affect all references
            compressionRegistry.unregister('mock');
            expect(compressionRegistry.get('mock')).toBeUndefined();
        });

        it('supports provider discovery pattern', () => {
            compressionRegistry.register(mockProvider);
            compressionRegistry.register(anotherMockProvider);

            // Discover all available providers
            const allProviders = compressionRegistry.getAll();

            // Filter by capability
            const proactiveProviders = allProviders.filter((p) => p.metadata?.isProactive === true);
            const llmProviders = allProviders.filter((p) => p.metadata?.requiresLLM === true);

            expect(proactiveProviders).toHaveLength(1);
            expect(proactiveProviders[0]!.type).toBe('mock');
            expect(llmProviders).toHaveLength(1);
            expect(llmProviders[0]!.type).toBe('another-mock');
        });
    });

    describe('Edge cases and error handling', () => {
        it('handles provider types with special characters', () => {
            const specialProvider: CompressionProvider = {
                type: 'special-provider_v2',
                configSchema: z.object({
                    type: z.literal('special-provider_v2'),
                }),
                create: () => ({
                    name: 'special-provider',
                    compress: async (history: readonly InternalMessage[]) =>
                        history.slice() as InternalMessage[],
                }),
            };

            compressionRegistry.register(specialProvider);

            expect(compressionRegistry.has('special-provider_v2')).toBe(true);
            expect(compressionRegistry.get('special-provider_v2')?.type).toBe(
                'special-provider_v2'
            );
        });

        it('preserves provider metadata exactly as provided', () => {
            compressionRegistry.register(mockProvider);

            const retrieved = compressionRegistry.get('mock');

            expect(retrieved?.metadata).toEqual(mockProvider.metadata);
            expect(retrieved?.metadata?.displayName).toBe(mockProvider.metadata?.displayName);
            expect(retrieved?.metadata?.description).toBe(mockProvider.metadata?.description);
            expect(retrieved?.metadata?.requiresLLM).toBe(mockProvider.metadata?.requiresLLM);
            expect(retrieved?.metadata?.isProactive).toBe(mockProvider.metadata?.isProactive);
        });

        it('handles providers without optional metadata gracefully', () => {
            compressionRegistry.register(minimalProvider);

            const provider = compressionRegistry.get('minimal');

            expect(provider).toBeDefined();
            expect(provider?.metadata).toBeUndefined();
            expect(provider?.type).toBe('minimal');
        });

        it('maintains type safety for provider retrieval', () => {
            compressionRegistry.register(mockProvider);

            const provider = compressionRegistry.get('mock');

            // TypeScript should know this is CompressionProvider<any, any>
            if (provider) {
                expect(provider.type).toBeDefined();
                expect(provider.configSchema).toBeDefined();
                expect(provider.create).toBeDefined();
            }
        });
    });
});
