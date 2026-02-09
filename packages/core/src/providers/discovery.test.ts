import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { listAllProviders, getProvidersByCategory, hasProvider } from './discovery.js';
import { compactionRegistry } from '../context/compaction/index.js';
import { customToolRegistry } from '../tools/custom-tool-registry.js';
import type { CustomToolProvider } from '../tools/custom-tool-registry.js';
import { z } from 'zod';

describe('Provider Discovery API', () => {
    beforeEach(() => {
        // Note: This API is intentionally backed by a mix of registries (compaction/custom tools)
        // and plain built-in exports (blob/database) during the DI refactor.
    });

    afterEach(() => {
        // Clean up any test providers we added
        // (Built-in providers remain registered)
    });

    describe('listAllProviders', () => {
        it('should return all registered providers grouped by category', () => {
            const providers = listAllProviders();

            expect(providers).toHaveProperty('blob');
            expect(providers).toHaveProperty('compaction');
            expect(providers).toHaveProperty('customTools');

            expect(Array.isArray(providers.blob)).toBe(true);
            expect(Array.isArray(providers.compaction)).toBe(true);
            expect(Array.isArray(providers.customTools)).toBe(true);
        });

        it('should include built-in blob providers', () => {
            const providers = listAllProviders();

            // Built-in blob providers: 'local' and 'in-memory'
            const types = providers.blob.map((p) => p.type);
            expect(types).toContain('local');
            expect(types).toContain('in-memory');
        });

        it('should include built-in compaction providers', () => {
            const providers = listAllProviders();

            // Built-in compaction providers: 'reactive-overflow' and 'noop'
            const types = providers.compaction.map((p) => p.type);
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

        it('should include built-in database providers', () => {
            const providers = listAllProviders();

            const types = providers.database.map((p) => p.type);
            expect(types).toContain('in-memory');
            expect(types).toContain('sqlite');
            expect(types).toContain('postgres');
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

        it('should return only compaction providers when category is compaction', () => {
            const providers = getProvidersByCategory('compaction');

            expect(Array.isArray(providers)).toBe(true);
            expect(providers.length).toBeGreaterThan(0);
            providers.forEach((p) => {
                expect(p.category).toBe('compaction');
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

        it('should return true for built-in database providers', () => {
            expect(hasProvider('database', 'in-memory')).toBe(true);
            expect(hasProvider('database', 'sqlite')).toBe(true);
            expect(hasProvider('database', 'postgres')).toBe(true);
        });

        it('should return false for unknown database providers', () => {
            expect(hasProvider('database', 'nonexistent')).toBe(false);
        });

        it('should return true for registered compaction providers', () => {
            expect(hasProvider('compaction', 'reactive-overflow')).toBe(true);
            expect(hasProvider('compaction', 'noop')).toBe(true);
        });

        it('should return false for unregistered compaction providers', () => {
            expect(hasProvider('compaction', 'nonexistent')).toBe(false);
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

        it('should have correct structure for compaction providers', () => {
            const providers = getProvidersByCategory('compaction');
            const noopProvider = providers.find((p) => p.type === 'noop');

            expect(noopProvider).toBeDefined();
            expect(noopProvider).toHaveProperty('type');
            expect(noopProvider).toHaveProperty('category');
            expect(noopProvider?.type).toBe('noop');
            expect(noopProvider?.category).toBe('compaction');
        });
    });
});
