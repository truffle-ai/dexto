import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { DatabaseRegistry } from './registry.js';
import type { DatabaseProvider } from './provider.js';
import type { Database } from './types.js';
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

// Mock Database implementation
class MockDatabase implements Database {
    constructor(private config: any) {}

    async get<T>(): Promise<T | undefined> {
        return undefined;
    }
    async set(): Promise<void> {}
    async delete(): Promise<void> {}
    async list(): Promise<string[]> {
        return [];
    }
    async append(): Promise<void> {}
    async getRange<T>(): Promise<T[]> {
        return [];
    }
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
        type: z.literal('mock-db-a'),
        path: z.string(),
        maxSize: z.number().optional().default(1000),
    })
    .strict();

type MockProviderAConfig = z.output<typeof MockProviderASchema>;

const mockProviderA: DatabaseProvider<'mock-db-a', MockProviderAConfig> = {
    type: 'mock-db-a',
    configSchema: MockProviderASchema,
    create: (config, _logger) => new MockDatabase(config),
    metadata: {
        displayName: 'Mock Database A',
        description: 'A mock database provider for testing',
        requiresNetwork: false,
        supportsListOperations: true,
    },
};

const MockProviderBSchema = z
    .object({
        type: z.literal('mock-db-b'),
        connectionString: z.string(),
    })
    .strict();

type MockProviderBConfig = z.output<typeof MockProviderBSchema>;

const mockProviderB: DatabaseProvider<'mock-db-b', MockProviderBConfig> = {
    type: 'mock-db-b',
    configSchema: MockProviderBSchema,
    create: (config, _logger) => new MockDatabase(config),
    metadata: {
        displayName: 'Mock Database B',
        description: 'Another mock database provider',
        requiresNetwork: true,
    },
};

describe('DatabaseRegistry', () => {
    let registry: DatabaseRegistry;

    beforeEach(() => {
        registry = new DatabaseRegistry();
    });

    describe('register()', () => {
        it('successfully registers a provider', () => {
            expect(() => registry.register(mockProviderA)).not.toThrow();
            expect(registry.has('mock-db-a')).toBe(true);
        });

        it('registers multiple providers with different types', () => {
            registry.register(mockProviderA);
            registry.register(mockProviderB);

            expect(registry.has('mock-db-a')).toBe(true);
            expect(registry.has('mock-db-b')).toBe(true);
        });

        it('throws error when registering duplicate provider type', () => {
            registry.register(mockProviderA);

            expect(() => registry.register(mockProviderA)).toThrow(
                expect.objectContaining({
                    code: StorageErrorCode.DATABASE_PROVIDER_ALREADY_REGISTERED,
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
                type: 'mock-db-a',
                path: '/tmp/data.db',
            };

            const validated = registry.validateConfig(config);
            expect(validated).toEqual({
                type: 'mock-db-a',
                path: '/tmp/data.db',
                maxSize: 1000, // default value applied
            });
        });

        it('throws error for unknown provider type', () => {
            const config = {
                type: 'unknown-provider',
                someField: 'value',
            };

            expect(() => registry.validateConfig(config)).toThrow(
                expect.objectContaining({
                    code: StorageErrorCode.DATABASE_PROVIDER_UNKNOWN,
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
                expect(error.context?.availableTypes).toContain('mock-db-a');
                expect(error.context?.availableTypes).toContain('mock-db-b');
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
        it('can create database instances using validated config', async () => {
            registry.register(mockProviderA);

            const config = {
                type: 'mock-db-a',
                path: '/tmp/test.db',
            };

            const validated = registry.validateConfig(config);
            const provider = registry.get('mock-db-a');

            expect(provider).toBeDefined();
            const store = await provider!.create(validated, mockLogger);
            expect(store).toBeInstanceOf(MockDatabase);
            if (!(store instanceof MockDatabase)) {
                throw new Error('Expected MockDatabase instance');
            }
            expect(store.getStoreType()).toBe('mock-db-a');
        });
    });

    describe('Provider Metadata', () => {
        it('preserves provider metadata after registration', () => {
            registry.register(mockProviderA);

            const provider = registry.get('mock-db-a');
            expect(provider?.metadata).toEqual({
                displayName: 'Mock Database A',
                description: 'A mock database provider for testing',
                requiresNetwork: false,
                supportsListOperations: true,
            });
        });
    });
});
