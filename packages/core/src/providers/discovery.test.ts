import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { listAllProviders, getProvidersByCategory, hasProvider } from './discovery.js';
import { blobStoreRegistry } from '../storage/blob/index.js';
import { compressionRegistry } from '../context/compression/index.js';
import { customToolRegistry } from '../tools/custom-tool-registry.js';
import type { BlobStoreProvider } from '../storage/blob/provider.js';
import type { CompressionProvider } from '../context/compression/provider.js';
import type { CustomToolProvider } from '../tools/custom-tool-registry.js';
import { z } from 'zod';

describe('Provider Discovery API', () => {
    // Store original registry state
    const originalBlobProviders = blobStoreRegistry.getTypes();
    const originalCompressionProviders = compressionRegistry.getTypes();
    const originalCustomToolProviders = customToolRegistry.getTypes();

    beforeEach(() => {
        // Note: We don't clear registries because built-in providers are registered
        // on module import. Tests work with the existing state.
    });

    afterEach(() => {
        // Clean up any test providers we added
        // (Built-in providers remain registered)
    });

    describe('listAllProviders', () => {
        it('should return all registered providers grouped by category', () => {
            const providers = listAllProviders();

            expect(providers).toHaveProperty('blob');
            expect(providers).toHaveProperty('compression');
            expect(providers).toHaveProperty('customTools');

            expect(Array.isArray(providers.blob)).toBe(true);
            expect(Array.isArray(providers.compression)).toBe(true);
            expect(Array.isArray(providers.customTools)).toBe(true);
        });

        it('should include built-in blob providers', () => {
            const providers = listAllProviders();

            // Built-in blob providers: 'local' and 'in-memory'
            const types = providers.blob.map((p) => p.type);
            expect(types).toContain('local');
            expect(types).toContain('in-memory');
        });

        it('should include built-in compression providers', () => {
            const providers = listAllProviders();

            // Built-in compression providers: 'reactive-overflow' and 'noop'
            const types = providers.compression.map((p) => p.type);
            expect(types).toContain('reactive-overflow');
            expect(types).toContain('noop');
        });

        it('should include provider metadata when available', () => {
            const providers = listAllProviders();

            // Check that blob providers have metadata
            const localProvider = providers.blob.find((p) => p.type === 'local');
            expect(localProvider).toBeDefined();
            expect(localProvider?.category).toBe('blob');
        });

        it('should include custom tool providers', () => {
            // Register a test custom tool provider
            const testProvider: CustomToolProvider = {
                type: 'test-tool',
                configSchema: z.object({ type: z.literal('test-tool') }),
                create: () => [],
                metadata: {
                    displayName: 'Test Tool',
                    description: 'A test tool provider',
                },
            };

            customToolRegistry.register(testProvider);

            const providers = listAllProviders();
            const testTool = providers.customTools.find((p) => p.type === 'test-tool');

            expect(testTool).toBeDefined();
            expect(testTool?.category).toBe('customTools');
            expect(testTool?.metadata?.displayName).toBe('Test Tool');

            // Cleanup
            customToolRegistry.unregister('test-tool');
        });
    });

    describe('getProvidersByCategory', () => {
        it('should return only blob providers when category is blob', () => {
            const providers = getProvidersByCategory('blob');

            expect(Array.isArray(providers)).toBe(true);
            expect(providers.length).toBeGreaterThan(0);
            providers.forEach((p) => {
                expect(p.category).toBe('blob');
            });
        });

        it('should return only compression providers when category is compression', () => {
            const providers = getProvidersByCategory('compression');

            expect(Array.isArray(providers)).toBe(true);
            expect(providers.length).toBeGreaterThan(0);
            providers.forEach((p) => {
                expect(p.category).toBe('compression');
            });
        });

        it('should return only custom tool providers when category is customTools', () => {
            const providers = getProvidersByCategory('customTools');

            expect(Array.isArray(providers)).toBe(true);
            // May be empty if no custom tools registered
            providers.forEach((p) => {
                expect(p.category).toBe('customTools');
            });
        });
    });

    describe('hasProvider', () => {
        it('should return true for registered blob providers', () => {
            expect(hasProvider('blob', 'local')).toBe(true);
            expect(hasProvider('blob', 'in-memory')).toBe(true);
        });

        it('should return false for unregistered blob providers', () => {
            expect(hasProvider('blob', 'nonexistent')).toBe(false);
        });

        it('should return true for registered compression providers', () => {
            expect(hasProvider('compression', 'reactive-overflow')).toBe(true);
            expect(hasProvider('compression', 'noop')).toBe(true);
        });

        it('should return false for unregistered compression providers', () => {
            expect(hasProvider('compression', 'nonexistent')).toBe(false);
        });

        it('should work correctly for custom tool providers', () => {
            // Initially should not exist
            expect(hasProvider('customTools', 'test-tool-2')).toBe(false);

            // Register a test provider
            const testProvider: CustomToolProvider = {
                type: 'test-tool-2',
                configSchema: z.object({ type: z.literal('test-tool-2') }),
                create: () => [],
            };

            customToolRegistry.register(testProvider);
            expect(hasProvider('customTools', 'test-tool-2')).toBe(true);

            // Cleanup
            customToolRegistry.unregister('test-tool-2');
            expect(hasProvider('customTools', 'test-tool-2')).toBe(false);
        });
    });

    describe('DiscoveredProvider structure', () => {
        it('should have correct structure for blob providers', () => {
            const providers = getProvidersByCategory('blob');
            const localProvider = providers.find((p) => p.type === 'local');

            expect(localProvider).toBeDefined();
            expect(localProvider).toHaveProperty('type');
            expect(localProvider).toHaveProperty('category');
            expect(localProvider?.type).toBe('local');
            expect(localProvider?.category).toBe('blob');
        });

        it('should have correct structure for compression providers', () => {
            const providers = getProvidersByCategory('compression');
            const noopProvider = providers.find((p) => p.type === 'noop');

            expect(noopProvider).toBeDefined();
            expect(noopProvider).toHaveProperty('type');
            expect(noopProvider).toHaveProperty('category');
            expect(noopProvider?.type).toBe('noop');
            expect(noopProvider?.category).toBe('compression');
        });
    });
});
