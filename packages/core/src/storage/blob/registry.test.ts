import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { BlobStoreRegistry } from './registry.js';
import type { BlobStoreProvider } from './provider.js';
import type { BlobStore } from './types.js';
import type { IDextoLogger } from '../../logger/v2/types.js';
import { StorageErrorCode } from '../error-codes.js';
import { ErrorScope, ErrorType } from '../../errors/types.js';

// Mock logger for testing
const mockLogger: IDextoLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trackException: vi.fn(),
    createChild: vi.fn(function (this: any) {
        return this;
    }),
    destroy: vi.fn(),
} as any;

// Mock BlobStore implementation
class MockBlobStore implements BlobStore {
    constructor(
        private config: any,
        private logger: IDextoLogger
    ) {}

    async store(): Promise<any> {
        throw new Error('Not implemented');
    }
    async retrieve(): Promise<any> {
        throw new Error('Not implemented');
    }
    async exists() {
        return false;
    }
    async delete() {}
    async cleanup() {
        return 0;
    }
    async getStats() {
        return { count: 0, totalSize: 0, backendType: 'mock', storePath: '/mock' };
    }
    async listBlobs() {
        return [];
    }
    getStoragePath() {
        return undefined;
    }
    async connect() {}
    async disconnect() {}
    isConnected() {
        return true;
    }
    getStoreType() {
        return this.config.type;
    }
}

// Mock provider configurations and schemas
const MockProviderASchema = z
    .object({
        type: z.literal('mock-a'),
        endpoint: z.string(),
        timeout: z.number().optional().default(5000),
    })
    .strict();

type MockProviderAConfig = z.output<typeof MockProviderASchema>;

const mockProviderA: BlobStoreProvider<'mock-a', MockProviderAConfig> = {
    type: 'mock-a',
    configSchema: MockProviderASchema,
    create: (config, logger) => new MockBlobStore(config, logger),
    metadata: {
        displayName: 'Mock Provider A',
        description: 'A mock provider for testing',
        requiresNetwork: true,
    },
};

const MockProviderBSchema = z
    .object({
        type: z.literal('mock-b'),
        storePath: z.string(),
        maxSize: z.number().int().positive().optional().default(1024),
    })
    .strict();

type MockProviderBConfig = z.output<typeof MockProviderBSchema>;

const mockProviderB: BlobStoreProvider<'mock-b', MockProviderBConfig> = {
    type: 'mock-b',
    configSchema: MockProviderBSchema,
    create: (config, logger) => new MockBlobStore(config, logger),
    metadata: {
        displayName: 'Mock Provider B',
        description: 'Another mock provider for testing',
        requiresNetwork: false,
    },
};

describe('BlobStoreRegistry', () => {
    let registry: BlobStoreRegistry;

    beforeEach(() => {
        registry = new BlobStoreRegistry();
    });

    describe('register()', () => {
        it('successfully registers a provider', () => {
            expect(() => registry.register(mockProviderA)).not.toThrow();
            expect(registry.has('mock-a')).toBe(true);
        });

        it('registers multiple providers with different types', () => {
            registry.register(mockProviderA);
            registry.register(mockProviderB);

            expect(registry.has('mock-a')).toBe(true);
            expect(registry.has('mock-b')).toBe(true);
            expect(registry.getTypes()).toEqual(['mock-a', 'mock-b']);
        });

        it('throws error when registering duplicate provider type', () => {
            registry.register(mockProviderA);

            expect(() => registry.register(mockProviderA)).toThrow(
                expect.objectContaining({
                    code: StorageErrorCode.BLOB_PROVIDER_ALREADY_REGISTERED,
                    scope: ErrorScope.STORAGE,
                    type: ErrorType.USER,
                })
            );
        });

        it('error message includes provider type for duplicate registration', () => {
            registry.register(mockProviderA);

            expect(() => registry.register(mockProviderA)).toThrow(/mock-a/);
        });
    });

    describe('unregister()', () => {
        it('successfully unregisters an existing provider', () => {
            registry.register(mockProviderA);
            expect(registry.has('mock-a')).toBe(true);

            const result = registry.unregister('mock-a');
            expect(result).toBe(true);
            expect(registry.has('mock-a')).toBe(false);
        });

        it('returns false when unregistering non-existent provider', () => {
            const result = registry.unregister('non-existent');
            expect(result).toBe(false);
        });

        it('returns false when unregistering already unregistered provider', () => {
            registry.register(mockProviderA);
            registry.unregister('mock-a');

            const result = registry.unregister('mock-a');
            expect(result).toBe(false);
        });

        it('does not affect other registered providers', () => {
            registry.register(mockProviderA);
            registry.register(mockProviderB);

            registry.unregister('mock-a');

            expect(registry.has('mock-a')).toBe(false);
            expect(registry.has('mock-b')).toBe(true);
        });
    });

    describe('get()', () => {
        it('returns registered provider by type', () => {
            registry.register(mockProviderA);

            const provider = registry.get('mock-a');
            expect(provider).toBe(mockProviderA);
        });

        it('returns undefined for non-existent provider', () => {
            const provider = registry.get('non-existent');
            expect(provider).toBeUndefined();
        });

        it('returns correct provider when multiple are registered', () => {
            registry.register(mockProviderA);
            registry.register(mockProviderB);

            const providerA = registry.get('mock-a');
            const providerB = registry.get('mock-b');

            expect(providerA).toBe(mockProviderA);
            expect(providerB).toBe(mockProviderB);
        });

        it('returns undefined after provider is unregistered', () => {
            registry.register(mockProviderA);
            registry.unregister('mock-a');

            const provider = registry.get('mock-a');
            expect(provider).toBeUndefined();
        });
    });

    describe('has()', () => {
        it('returns true for registered provider', () => {
            registry.register(mockProviderA);
            expect(registry.has('mock-a')).toBe(true);
        });

        it('returns false for non-existent provider', () => {
            expect(registry.has('non-existent')).toBe(false);
        });

        it('returns false after provider is unregistered', () => {
            registry.register(mockProviderA);
            registry.unregister('mock-a');
            expect(registry.has('mock-a')).toBe(false);
        });

        it('works correctly with multiple providers', () => {
            registry.register(mockProviderA);
            registry.register(mockProviderB);

            expect(registry.has('mock-a')).toBe(true);
            expect(registry.has('mock-b')).toBe(true);
            expect(registry.has('mock-c')).toBe(false);
        });
    });

    describe('getTypes()', () => {
        it('returns empty array when no providers are registered', () => {
            expect(registry.getTypes()).toEqual([]);
        });

        it('returns array with single provider type', () => {
            registry.register(mockProviderA);
            expect(registry.getTypes()).toEqual(['mock-a']);
        });

        it('returns array with all registered provider types', () => {
            registry.register(mockProviderA);
            registry.register(mockProviderB);

            const types = registry.getTypes();
            expect(types).toHaveLength(2);
            expect(types).toContain('mock-a');
            expect(types).toContain('mock-b');
        });

        it('updates after unregistering a provider', () => {
            registry.register(mockProviderA);
            registry.register(mockProviderB);
            registry.unregister('mock-a');

            expect(registry.getTypes()).toEqual(['mock-b']);
        });
    });

    describe('getProviders()', () => {
        it('returns empty array when no providers are registered', () => {
            expect(registry.getProviders()).toEqual([]);
        });

        it('returns array with single provider', () => {
            registry.register(mockProviderA);
            expect(registry.getProviders()).toEqual([mockProviderA]);
        });

        it('returns array with all registered providers', () => {
            registry.register(mockProviderA);
            registry.register(mockProviderB);

            const providers = registry.getProviders();
            expect(providers).toHaveLength(2);
            expect(providers).toContain(mockProviderA);
            expect(providers).toContain(mockProviderB);
        });

        it('updates after unregistering a provider', () => {
            registry.register(mockProviderA);
            registry.register(mockProviderB);
            registry.unregister('mock-a');

            expect(registry.getProviders()).toEqual([mockProviderB]);
        });
    });

    describe('validateConfig()', () => {
        beforeEach(() => {
            registry.register(mockProviderA);
            registry.register(mockProviderB);
        });

        it('validates config with correct type and structure', () => {
            const config = {
                type: 'mock-a',
                endpoint: 'https://example.com',
            };

            const validated = registry.validateConfig(config);
            expect(validated).toEqual({
                type: 'mock-a',
                endpoint: 'https://example.com',
                timeout: 5000, // default value applied
            });
        });

        it('applies default values from provider schema', () => {
            const config = {
                type: 'mock-b',
                storePath: '/tmp/blobs',
            };

            const validated = registry.validateConfig(config);
            expect(validated).toEqual({
                type: 'mock-b',
                storePath: '/tmp/blobs',
                maxSize: 1024, // default value applied
            });
        });

        it('throws error for missing type field', () => {
            const config = {
                endpoint: 'https://example.com',
            };

            expect(() => registry.validateConfig(config)).toThrow();
        });

        it('throws error for unknown provider type', () => {
            const config = {
                type: 'unknown-provider',
                someField: 'value',
            };

            expect(() => registry.validateConfig(config)).toThrow(
                expect.objectContaining({
                    code: StorageErrorCode.BLOB_PROVIDER_UNKNOWN,
                    scope: ErrorScope.STORAGE,
                    type: ErrorType.USER,
                })
            );
        });

        it('error message includes unknown type and available types', () => {
            const config = {
                type: 'unknown-provider',
            };

            try {
                registry.validateConfig(config);
                expect.fail('Should have thrown error');
            } catch (error: any) {
                expect(error.message).toContain('unknown-provider');
                expect(error.context?.availableTypes).toEqual(['mock-a', 'mock-b']);
            }
        });

        it('throws validation error for invalid config structure', () => {
            const config = {
                type: 'mock-a',
                endpoint: 123, // should be string
            };

            expect(() => registry.validateConfig(config)).toThrow();
        });

        it('throws validation error for missing required fields', () => {
            const config = {
                type: 'mock-a',
                // missing required 'endpoint' field
            };

            expect(() => registry.validateConfig(config)).toThrow();
        });

        it('rejects extra fields in strict schema', () => {
            const config = {
                type: 'mock-a',
                endpoint: 'https://example.com',
                extraField: 'not-allowed',
            };

            expect(() => registry.validateConfig(config)).toThrow();
        });

        it('validates multiple different configs successfully', () => {
            const configA = {
                type: 'mock-a',
                endpoint: 'https://api.example.com',
                timeout: 10000,
            };

            const configB = {
                type: 'mock-b',
                storePath: '/var/blobs',
                maxSize: 2048,
            };

            const validatedA = registry.validateConfig(configA);
            const validatedB = registry.validateConfig(configB);

            expect(validatedA.type).toBe('mock-a');
            expect(validatedB.type).toBe('mock-b');
        });
    });

    describe('clear()', () => {
        it('removes all registered providers', () => {
            registry.register(mockProviderA);
            registry.register(mockProviderB);

            expect(registry.getTypes()).toHaveLength(2);

            registry.clear();

            expect(registry.getTypes()).toEqual([]);
            expect(registry.getProviders()).toEqual([]);
        });

        it('works when no providers are registered', () => {
            expect(() => registry.clear()).not.toThrow();
            expect(registry.getTypes()).toEqual([]);
        });

        it('allows registering new providers after clear', () => {
            registry.register(mockProviderA);
            registry.clear();
            registry.register(mockProviderB);

            expect(registry.has('mock-a')).toBe(false);
            expect(registry.has('mock-b')).toBe(true);
        });

        it('allows re-registering same provider after clear', () => {
            registry.register(mockProviderA);
            registry.clear();

            expect(() => registry.register(mockProviderA)).not.toThrow();
            expect(registry.has('mock-a')).toBe(true);
        });
    });

    describe('Provider Creation', () => {
        it('can create blob store instances using validated config', () => {
            registry.register(mockProviderA);

            const config = {
                type: 'mock-a',
                endpoint: 'https://example.com',
            };

            const validated = registry.validateConfig(config);
            const provider = registry.get('mock-a');

            expect(provider).toBeDefined();
            const store = provider!.create(validated, mockLogger);
            expect(store).toBeInstanceOf(MockBlobStore);
            expect(store.getStoreType()).toBe('mock-a');
        });

        it('passes validated config with defaults to create method', () => {
            registry.register(mockProviderA);

            const config = {
                type: 'mock-a',
                endpoint: 'https://example.com',
            };

            const validated = registry.validateConfig(config);
            expect(validated.timeout).toBe(5000); // default applied

            const provider = registry.get('mock-a');
            const store = provider!.create(validated, mockLogger);

            expect(store).toBeDefined();
        });
    });

    describe('Edge Cases', () => {
        it('handles empty string as provider type', () => {
            const config = {
                type: '',
            };

            expect(() => registry.validateConfig(config)).toThrow(
                expect.objectContaining({
                    code: StorageErrorCode.BLOB_PROVIDER_UNKNOWN,
                })
            );
        });

        it('handles null config gracefully', () => {
            expect(() => registry.validateConfig(null)).toThrow();
        });

        it('handles undefined config gracefully', () => {
            expect(() => registry.validateConfig(undefined)).toThrow();
        });

        it('handles array as config gracefully', () => {
            expect(() => registry.validateConfig([])).toThrow();
        });

        it('handles string as config gracefully', () => {
            expect(() => registry.validateConfig('not-an-object')).toThrow();
        });

        it('handles number as config gracefully', () => {
            expect(() => registry.validateConfig(42)).toThrow();
        });
    });

    describe('Provider Metadata', () => {
        it('preserves provider metadata after registration', () => {
            registry.register(mockProviderA);

            const provider = registry.get('mock-a');
            expect(provider?.metadata).toEqual({
                displayName: 'Mock Provider A',
                description: 'A mock provider for testing',
                requiresNetwork: true,
            });
        });

        it('handles providers without metadata', () => {
            const providerWithoutMetadata: BlobStoreProvider<'no-meta', { type: 'no-meta' }> = {
                type: 'no-meta',
                configSchema: z.object({ type: z.literal('no-meta') }).strict(),
                create: (config, logger) => new MockBlobStore(config, logger),
            };

            registry.register(providerWithoutMetadata);
            const provider = registry.get('no-meta');

            expect(provider?.metadata).toBeUndefined();
        });
    });
});
