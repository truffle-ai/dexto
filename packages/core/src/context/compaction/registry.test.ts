import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { compactionRegistry } from './registry.js';
import type { CompactionProvider, CompactionConfig, CompactionContext } from './provider.js';
import type { ICompactionStrategy } from './types.js';
import type { InternalMessage } from '../types.js';

// Mock compaction config types
interface MockCompactionConfig extends CompactionConfig {
    type: 'mock';
    enabled?: boolean;
    maxTokens?: number;
}

interface AnotherMockConfig extends CompactionConfig {
    type: 'another-mock';
    enabled?: boolean;
    threshold?: number;
}

// Mock compaction strategy implementation
class MockCompressionStrategy implements ICompactionStrategy {
    readonly name = 'mock-compaction';

    constructor(private config: MockCompactionConfig) {}

    async compact(history: readonly InternalMessage[]): Promise<InternalMessage[]> {
        return history.slice(0, this.config.maxTokens || 100) as InternalMessage[];
    }
}

class AnotherMockStrategy implements ICompactionStrategy {
    readonly name = 'another-mock-compaction';

    constructor(private config: AnotherMockConfig) {}

    async compact(history: readonly InternalMessage[]): Promise<InternalMessage[]> {
        return history.slice(0, this.config.threshold || 50) as InternalMessage[];
    }
}

// Mock compaction providers
const mockProvider: CompactionProvider<'mock', MockCompactionConfig> = {
    type: 'mock',
    configSchema: z.object({
        type: z.literal('mock'),
        enabled: z.boolean().default(true),
        maxTokens: z.number().default(100),
    }),
    metadata: {
        displayName: 'Mock Compaction',
        description: 'A mock compaction strategy for testing',
        requiresLLM: false,
        isProactive: true,
    },
    create(config: MockCompactionConfig, _context: CompactionContext): ICompactionStrategy {
        return new MockCompressionStrategy(config);
    },
};

const anotherMockProvider: CompactionProvider<'another-mock', AnotherMockConfig> = {
    type: 'another-mock',
    configSchema: z.object({
        type: z.literal('another-mock'),
        enabled: z.boolean().default(true),
        threshold: z.number().default(50),
    }),
    metadata: {
        displayName: 'Another Mock Compaction',
        description: 'Another mock compaction strategy for testing',
        requiresLLM: true,
        isProactive: false,
    },
    create(config: AnotherMockConfig, _context: CompactionContext): ICompactionStrategy {
        return new AnotherMockStrategy(config);
    },
};

const minimalProvider: CompactionProvider<'minimal', CompactionConfig> = {
    type: 'minimal',
    configSchema: z.object({
        type: z.literal('minimal'),
        enabled: z.boolean().default(true),
    }),
    create(_config: CompactionConfig, _context: CompactionContext): ICompactionStrategy {
        return {
            name: 'minimal-compaction',
            compact: async (history: readonly InternalMessage[]) =>
                history.slice() as InternalMessage[],
        };
    },
};

describe('CompactionRegistry', () => {
    beforeEach(() => {
        // Clear registry before each test to ensure isolation
        compactionRegistry.clear();
    });

    describe('register()', () => {
        it('successfully registers a provider', () => {
            expect(() => compactionRegistry.register(mockProvider)).not.toThrow();
            expect(compactionRegistry.has('mock')).toBe(true);
        });

        it('successfully registers multiple providers', () => {
            compactionRegistry.register(mockProvider);
            compactionRegistry.register(anotherMockProvider);

            expect(compactionRegistry.has('mock')).toBe(true);
            expect(compactionRegistry.has('another-mock')).toBe(true);
        });

        it('throws error when registering duplicate provider', () => {
            compactionRegistry.register(mockProvider);

            expect(() => compactionRegistry.register(mockProvider)).toThrow(
                "Compaction provider 'mock' is already registered"
            );
        });

        it('allows re-registration after unregistering', () => {
            compactionRegistry.register(mockProvider);
            compactionRegistry.unregister('mock');

            expect(() => compactionRegistry.register(mockProvider)).not.toThrow();
            expect(compactionRegistry.has('mock')).toBe(true);
        });

        it('registers provider with minimal metadata', () => {
            compactionRegistry.register(minimalProvider);

            const provider = compactionRegistry.get('minimal');
            expect(provider).toBeDefined();
            expect(provider?.type).toBe('minimal');
            expect(provider?.metadata).toBeUndefined();
        });
    });

    describe('unregister()', () => {
        it('successfully unregisters an existing provider', () => {
            compactionRegistry.register(mockProvider);

            const result = compactionRegistry.unregister('mock');

            expect(result).toBe(true);
            expect(compactionRegistry.has('mock')).toBe(false);
        });

        it('returns false when unregistering non-existent provider', () => {
            const result = compactionRegistry.unregister('non-existent');

            expect(result).toBe(false);
        });

        it('returns false when unregistering from empty registry', () => {
            const result = compactionRegistry.unregister('mock');

            expect(result).toBe(false);
        });

        it('can unregister one provider while keeping others', () => {
            compactionRegistry.register(mockProvider);
            compactionRegistry.register(anotherMockProvider);

            const result = compactionRegistry.unregister('mock');

            expect(result).toBe(true);
            expect(compactionRegistry.has('mock')).toBe(false);
            expect(compactionRegistry.has('another-mock')).toBe(true);
        });
    });

    describe('get()', () => {
        it('returns registered provider', () => {
            compactionRegistry.register(mockProvider);

            const provider = compactionRegistry.get('mock');

            expect(provider).toBeDefined();
            expect(provider?.type).toBe('mock');
            expect(provider?.metadata?.displayName).toBe('Mock Compaction');
        });

        it('returns undefined for non-existent provider', () => {
            const provider = compactionRegistry.get('non-existent');

            expect(provider).toBeUndefined();
        });

        it('returns undefined from empty registry', () => {
            const provider = compactionRegistry.get('mock');

            expect(provider).toBeUndefined();
        });

        it('returns correct provider when multiple are registered', () => {
            compactionRegistry.register(mockProvider);
            compactionRegistry.register(anotherMockProvider);

            const provider1 = compactionRegistry.get('mock');
            const provider2 = compactionRegistry.get('another-mock');

            expect(provider1?.type).toBe('mock');
            expect(provider2?.type).toBe('another-mock');
        });

        it('returns full provider interface including create function', () => {
            compactionRegistry.register(mockProvider);

            const provider = compactionRegistry.get('mock');

            expect(provider).toBeDefined();
            expect(typeof provider?.create).toBe('function');
            expect(provider?.configSchema).toBeDefined();
        });
    });

    describe('has()', () => {
        it('returns true for registered provider', () => {
            compactionRegistry.register(mockProvider);

            expect(compactionRegistry.has('mock')).toBe(true);
        });

        it('returns false for non-existent provider', () => {
            expect(compactionRegistry.has('non-existent')).toBe(false);
        });

        it('returns false from empty registry', () => {
            expect(compactionRegistry.has('mock')).toBe(false);
        });

        it('returns false after unregistering', () => {
            compactionRegistry.register(mockProvider);
            compactionRegistry.unregister('mock');

            expect(compactionRegistry.has('mock')).toBe(false);
        });

        it('correctly identifies multiple registered providers', () => {
            compactionRegistry.register(mockProvider);
            compactionRegistry.register(anotherMockProvider);

            expect(compactionRegistry.has('mock')).toBe(true);
            expect(compactionRegistry.has('another-mock')).toBe(true);
            expect(compactionRegistry.has('non-existent')).toBe(false);
        });
    });

    describe('getTypes()', () => {
        it('returns all registered provider types', () => {
            compactionRegistry.register(mockProvider);
            compactionRegistry.register(anotherMockProvider);

            const types = compactionRegistry.getTypes();

            expect(types).toHaveLength(2);
            expect(types).toContain('mock');
            expect(types).toContain('another-mock');
        });

        it('returns empty array for empty registry', () => {
            const types = compactionRegistry.getTypes();

            expect(types).toEqual([]);
        });

        it('returns single type when only one provider is registered', () => {
            compactionRegistry.register(mockProvider);

            const types = compactionRegistry.getTypes();

            expect(types).toEqual(['mock']);
        });

        it('updates after unregistering a provider', () => {
            compactionRegistry.register(mockProvider);
            compactionRegistry.register(anotherMockProvider);
            compactionRegistry.unregister('mock');

            const types = compactionRegistry.getTypes();

            expect(types).toHaveLength(1);
            expect(types).toContain('another-mock');
            expect(types).not.toContain('mock');
        });

        it('returns array that can be iterated', () => {
            compactionRegistry.register(mockProvider);
            compactionRegistry.register(anotherMockProvider);

            const types = compactionRegistry.getTypes();
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
            compactionRegistry.register(mockProvider);
            compactionRegistry.register(anotherMockProvider);

            const providers = compactionRegistry.getAll();

            expect(providers).toHaveLength(2);
            expect(providers[0]!.type).toBe('mock');
            expect(providers[1]!.type).toBe('another-mock');
        });

        it('returns empty array for empty registry', () => {
            const providers = compactionRegistry.getAll();

            expect(providers).toEqual([]);
        });

        it('returns single provider when only one is registered', () => {
            compactionRegistry.register(mockProvider);

            const providers = compactionRegistry.getAll();

            expect(providers).toHaveLength(1);
            expect(providers[0]!.type).toBe('mock');
        });

        it('updates after unregistering a provider', () => {
            compactionRegistry.register(mockProvider);
            compactionRegistry.register(anotherMockProvider);
            compactionRegistry.unregister('mock');

            const providers = compactionRegistry.getAll();

            expect(providers).toHaveLength(1);
            expect(providers[0]!.type).toBe('another-mock');
        });

        it('returns providers with full interface including metadata', () => {
            compactionRegistry.register(mockProvider);
            compactionRegistry.register(anotherMockProvider);

            const providers = compactionRegistry.getAll();

            expect(providers[0]!.metadata).toBeDefined();
            expect(providers[0]!.metadata?.displayName).toBe('Mock Compaction');
            expect(providers[1]!.metadata).toBeDefined();
            expect(providers[1]!.metadata?.requiresLLM).toBe(true);
        });

        it('returns array that can be filtered and mapped', () => {
            compactionRegistry.register(mockProvider);
            compactionRegistry.register(anotherMockProvider);
            compactionRegistry.register(minimalProvider);

            const providers = compactionRegistry.getAll();
            const providersWithLLM = providers.filter((p) => p.metadata?.requiresLLM === true);
            const providerTypes = providers.map((p) => p.type);

            expect(providersWithLLM).toHaveLength(1);
            expect(providersWithLLM[0]!.type).toBe('another-mock');
            expect(providerTypes).toEqual(['mock', 'another-mock', 'minimal']);
        });
    });

    describe('clear()', () => {
        it('clears all registered providers', () => {
            compactionRegistry.register(mockProvider);
            compactionRegistry.register(anotherMockProvider);

            compactionRegistry.clear();

            expect(compactionRegistry.getTypes()).toEqual([]);
            expect(compactionRegistry.getAll()).toEqual([]);
            expect(compactionRegistry.has('mock')).toBe(false);
            expect(compactionRegistry.has('another-mock')).toBe(false);
        });

        it('can clear empty registry without errors', () => {
            expect(() => compactionRegistry.clear()).not.toThrow();

            expect(compactionRegistry.getTypes()).toEqual([]);
        });

        it('allows re-registration after clearing', () => {
            compactionRegistry.register(mockProvider);
            compactionRegistry.clear();

            expect(() => compactionRegistry.register(mockProvider)).not.toThrow();
            expect(compactionRegistry.has('mock')).toBe(true);
        });

        it('truly removes all providers including their state', () => {
            compactionRegistry.register(mockProvider);
            compactionRegistry.register(anotherMockProvider);
            compactionRegistry.register(minimalProvider);

            compactionRegistry.clear();

            expect(compactionRegistry.get('mock')).toBeUndefined();
            expect(compactionRegistry.get('another-mock')).toBeUndefined();
            expect(compactionRegistry.get('minimal')).toBeUndefined();
            expect(compactionRegistry.getAll().length).toBe(0);
        });
    });

    describe('Integration scenarios', () => {
        it('supports complete provider lifecycle', () => {
            // Register
            compactionRegistry.register(mockProvider);
            expect(compactionRegistry.has('mock')).toBe(true);

            // Get and verify
            const provider = compactionRegistry.get('mock');
            expect(provider?.type).toBe('mock');

            // Use provider
            expect(typeof provider?.create).toBe('function');

            // Unregister
            const unregistered = compactionRegistry.unregister('mock');
            expect(unregistered).toBe(true);
            expect(compactionRegistry.has('mock')).toBe(false);
        });

        it('handles multiple provider types with different configurations', () => {
            compactionRegistry.register(mockProvider);
            compactionRegistry.register(anotherMockProvider);
            compactionRegistry.register(minimalProvider);

            const types = compactionRegistry.getTypes();
            expect(types).toHaveLength(3);

            const withMetadata = compactionRegistry
                .getAll()
                .filter((p) => p.metadata !== undefined);
            expect(withMetadata).toHaveLength(2);

            const requiresLLM = compactionRegistry
                .getAll()
                .filter((p) => p.metadata?.requiresLLM === true);
            expect(requiresLLM).toHaveLength(1);
            expect(requiresLLM[0]!.type).toBe('another-mock');
        });

        it('maintains provider isolation between operations', () => {
            compactionRegistry.register(mockProvider);

            const provider1 = compactionRegistry.get('mock');
            const provider2 = compactionRegistry.get('mock');

            // Both should return the same provider instance
            expect(provider1).toBe(provider2);

            // Unregistering should affect all references
            compactionRegistry.unregister('mock');
            expect(compactionRegistry.get('mock')).toBeUndefined();
        });

        it('supports provider discovery pattern', () => {
            compactionRegistry.register(mockProvider);
            compactionRegistry.register(anotherMockProvider);

            // Discover all available providers
            const allProviders = compactionRegistry.getAll();

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
            const specialProvider: CompactionProvider = {
                type: 'special-provider_v2',
                configSchema: z.object({
                    type: z.literal('special-provider_v2'),
                }),
                create: () => ({
                    name: 'special-provider',
                    compact: async (history: readonly InternalMessage[]) =>
                        history.slice() as InternalMessage[],
                }),
            };

            compactionRegistry.register(specialProvider);

            expect(compactionRegistry.has('special-provider_v2')).toBe(true);
            expect(compactionRegistry.get('special-provider_v2')?.type).toBe('special-provider_v2');
        });

        it('preserves provider metadata exactly as provided', () => {
            compactionRegistry.register(mockProvider);

            const retrieved = compactionRegistry.get('mock');

            expect(retrieved?.metadata).toEqual(mockProvider.metadata);
            expect(retrieved?.metadata?.displayName).toBe(mockProvider.metadata?.displayName);
            expect(retrieved?.metadata?.description).toBe(mockProvider.metadata?.description);
            expect(retrieved?.metadata?.requiresLLM).toBe(mockProvider.metadata?.requiresLLM);
            expect(retrieved?.metadata?.isProactive).toBe(mockProvider.metadata?.isProactive);
        });

        it('handles providers without optional metadata gracefully', () => {
            compactionRegistry.register(minimalProvider);

            const provider = compactionRegistry.get('minimal');

            expect(provider).toBeDefined();
            expect(provider?.metadata).toBeUndefined();
            expect(provider?.type).toBe('minimal');
        });

        it('maintains type safety for provider retrieval', () => {
            compactionRegistry.register(mockProvider);

            const provider = compactionRegistry.get('mock');

            // TypeScript should know this is CompactionProvider<any, any>
            if (provider) {
                expect(provider.type).toBeDefined();
                expect(provider.configSchema).toBeDefined();
                expect(provider.create).toBeDefined();
            }
        });
    });
});
