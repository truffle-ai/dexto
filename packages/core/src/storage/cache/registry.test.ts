import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { CacheRegistry } from './registry.js';
import type { CacheProvider } from './provider.js';
import type { Cache } from './types.js';
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

// Mock Cache implementation
class MockCache implements Cache {
    constructor(private config: any) {}

    async get<T>(): Promise<T | undefined> {
        return undefined;
    }
    async set(): Promise<void> {}
    async delete(): Promise<void> {}
    async connect(): Promise<void> {}
    async disconnect(): Promise<void> {}
    isConnected(): boolean {
        return true;
    }
    getStoreType(): string {
        return this.config.type;
    }
}

// Mock provider configurations and schemas
const MockProviderASchema = z
    .object({
        type: z.literal('mock-cache-a'),
        maxSize: z.number().optional().default(100),
    })
    .strict();

type MockProviderAConfig = z.output<typeof MockProviderASchema>;

const mockProviderA: CacheProvider<'mock-cache-a', MockProviderAConfig> = {
    type: 'mock-cache-a',
    configSchema: MockProviderASchema,
    create: (config, _logger) => new MockCache(config),
    metadata: {
        displayName: 'Mock Cache A',
        description: 'A mock cache provider for testing',
        requiresNetwork: false,
        supportsTTL: true,
    },
};

const MockProviderBSchema = z
    .object({
        type: z.literal('mock-cache-b'),
        host: z.string(),
        port: z.number().optional().default(6379),
    })
    .strict();

type MockProviderBConfig = z.output<typeof MockProviderBSchema>;

const mockProviderB: CacheProvider<'mock-cache-b', MockProviderBConfig> = {
    type: 'mock-cache-b',
    configSchema: MockProviderBSchema,
    create: (config, _logger) => new MockCache(config),
    metadata: {
        displayName: 'Mock Cache B',
        description: 'Another mock cache provider',
        requiresNetwork: true,
        supportsTTL: true,
    },
};

describe('CacheRegistry', () => {
    let registry: CacheRegistry;

    beforeEach(() => {
        registry = new CacheRegistry();
    });

    describe('register()', () => {
        it('successfully registers a provider', () => {
            expect(() => registry.register(mockProviderA)).not.toThrow();
            expect(registry.has('mock-cache-a')).toBe(true);
        });

        it('registers multiple providers with different types', () => {
            registry.register(mockProviderA);
            registry.register(mockProviderB);

            expect(registry.has('mock-cache-a')).toBe(true);
            expect(registry.has('mock-cache-b')).toBe(true);
        });

        it('throws error when registering duplicate provider type', () => {
            registry.register(mockProviderA);

            expect(() => registry.register(mockProviderA)).toThrow(
                expect.objectContaining({
                    code: StorageErrorCode.CACHE_PROVIDER_ALREADY_REGISTERED,
                    scope: ErrorScope.STORAGE,
                    type: ErrorType.USER,
                })
            );
        });
    });

    describe('validateConfig()', () => {
        beforeEach(() => {
            registry.register(mockProviderA);
            registry.register(mockProviderB);
        });

        it('validates config with correct type and structure', () => {
            const config = {
                type: 'mock-cache-a',
            };

            const validated = registry.validateConfig(config);
            expect(validated).toEqual({
                type: 'mock-cache-a',
                maxSize: 100, // default value applied
            });
        });

        it('throws error for unknown provider type', () => {
            const config = {
                type: 'unknown-provider',
                someField: 'value',
            };

            expect(() => registry.validateConfig(config)).toThrow(
                expect.objectContaining({
                    code: StorageErrorCode.CACHE_PROVIDER_UNKNOWN,
                    scope: ErrorScope.STORAGE,
                    type: ErrorType.USER,
                })
            );
        });

        it('error message includes available types', () => {
            const config = {
                type: 'unknown-provider',
            };

            try {
                registry.validateConfig(config);
                expect.fail('Should have thrown error');
            } catch (error: any) {
                expect(error.message).toContain('unknown-provider');
                expect(error.context?.availableTypes).toContain('mock-cache-a');
                expect(error.context?.availableTypes).toContain('mock-cache-b');
            }
        });
    });

    describe('getProviders()', () => {
        it('returns all registered providers', () => {
            registry.register(mockProviderA);
            registry.register(mockProviderB);

            const providers = registry.getProviders();
            expect(providers).toHaveLength(2);
            expect(providers).toContain(mockProviderA);
            expect(providers).toContain(mockProviderB);
        });
    });

    describe('Provider Creation', () => {
        it('can create cache instances using validated config', async () => {
            registry.register(mockProviderA);

            const config = {
                type: 'mock-cache-a',
            };

            const validated = registry.validateConfig(config);
            const provider = registry.get('mock-cache-a');

            expect(provider).toBeDefined();
            const store = await provider!.create(validated, mockLogger);
            expect(store).toBeInstanceOf(MockCache);
            if (!(store instanceof MockCache)) {
                throw new Error('Expected MockCache instance');
            }
            expect(store.getStoreType()).toBe('mock-cache-a');
        });
    });

    describe('Provider Metadata', () => {
        it('preserves provider metadata after registration', () => {
            registry.register(mockProviderA);

            const provider = registry.get('mock-cache-a');
            expect(provider?.metadata).toEqual({
                displayName: 'Mock Cache A',
                description: 'A mock cache provider for testing',
                requiresNetwork: false,
                supportsTTL: true,
            });
        });
    });
});
