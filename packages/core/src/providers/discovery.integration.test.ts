import { describe, it, expect } from 'vitest';
import { listAllProviders, getProvidersByCategory, hasProvider } from './discovery.js';

/**
 * Integration tests for Provider Discovery API
 * These tests verify that the discovery API correctly interacts with all registries
 * and that built-in providers are properly registered.
 */
describe('Provider Discovery API - Integration', () => {
    describe('Built-in Provider Registration', () => {
        it('should have blob storage providers registered on module import', () => {
            const providers = listAllProviders();

            // Verify built-in blob providers are registered
            expect(providers.blob.length).toBeGreaterThanOrEqual(2);

            const types = providers.blob.map((p) => p.type);
            expect(types).toContain('local');
            expect(types).toContain('in-memory');
        });

        it('should have compaction providers registered on module import', () => {
            const providers = listAllProviders();

            // Verify built-in compaction providers are registered
            expect(providers.compaction.length).toBeGreaterThanOrEqual(2);

            const types = providers.compaction.map((p) => p.type);
            expect(types).toContain('reactive-overflow');
            expect(types).toContain('noop');
        });

        it('should have valid metadata for built-in providers', () => {
            const providers = listAllProviders();

            // Check blob providers have metadata
            for (const provider of providers.blob) {
                expect(provider.type).toBeTruthy();
                expect(provider.category).toBe('blob');
                // Metadata is optional but if present should have displayName or description
                if (provider.metadata) {
                    const hasDisplayName = provider.metadata.displayName !== undefined;
                    const hasDescription = provider.metadata.description !== undefined;
                    expect(hasDisplayName || hasDescription).toBe(true);
                }
            }

            // Check compaction providers have metadata
            for (const provider of providers.compaction) {
                expect(provider.type).toBeTruthy();
                expect(provider.category).toBe('compaction');
                if (provider.metadata) {
                    const hasDisplayName = provider.metadata.displayName !== undefined;
                    const hasDescription = provider.metadata.description !== undefined;
                    expect(hasDisplayName || hasDescription).toBe(true);
                }
            }
        });
    });

    describe('Cross-Registry Queries', () => {
        it('should correctly separate providers by category', () => {
            const allProviders = listAllProviders();

            // All blob providers should have blob category
            allProviders.blob.forEach((p) => {
                expect(p.category).toBe('blob');
            });

            // All compaction providers should have compaction category
            allProviders.compaction.forEach((p) => {
                expect(p.category).toBe('compaction');
            });

            // All custom tool providers should have customTools category
            allProviders.customTools.forEach((p) => {
                expect(p.category).toBe('customTools');
            });
        });

        it('should return consistent results between listAllProviders and getProvidersByCategory', () => {
            const allProviders = listAllProviders();

            const blobViaList = allProviders.blob;
            const blobViaCategory = getProvidersByCategory('blob');
            expect(blobViaList).toEqual(blobViaCategory);

            const compactionViaList = allProviders.compaction;
            const compactionViaCategory = getProvidersByCategory('compaction');
            expect(compactionViaList).toEqual(compactionViaCategory);

            const customToolsViaList = allProviders.customTools;
            const customToolsViaCategory = getProvidersByCategory('customTools');
            expect(customToolsViaList).toEqual(customToolsViaCategory);
        });

        it('should have consistent results between hasProvider and listAllProviders', () => {
            const allProviders = listAllProviders();

            // For each blob provider, hasProvider should return true
            for (const provider of allProviders.blob) {
                expect(hasProvider('blob', provider.type)).toBe(true);
            }

            // For each compaction provider, hasProvider should return true
            for (const provider of allProviders.compaction) {
                expect(hasProvider('compaction', provider.type)).toBe(true);
            }

            // For each custom tool provider, hasProvider should return true
            for (const provider of allProviders.customTools) {
                expect(hasProvider('customTools', provider.type)).toBe(true);
            }

            // Non-existent providers should return false
            expect(hasProvider('blob', 'nonexistent-provider-xyz')).toBe(false);
            expect(hasProvider('compaction', 'nonexistent-provider-xyz')).toBe(false);
            expect(hasProvider('customTools', 'nonexistent-provider-xyz')).toBe(false);
        });
    });

    describe('Real-World Scenarios', () => {
        it('should support debugging scenario: list all available providers', () => {
            const providers = listAllProviders();

            // Verify we can iterate through all providers for debugging
            const summary = {
                blobCount: providers.blob.length,
                compactionCount: providers.compaction.length,
                customToolsCount: providers.customTools.length,
                total:
                    providers.blob.length +
                    providers.compaction.length +
                    providers.customTools.length,
            };

            expect(summary.blobCount).toBeGreaterThanOrEqual(2);
            expect(summary.compactionCount).toBeGreaterThanOrEqual(2);
            expect(summary.total).toBeGreaterThanOrEqual(4);
        });

        it('should support validation scenario: check required providers exist', () => {
            // Scenario: App requires local blob storage and reactive-overflow compaction
            const requiredProviders = [
                { category: 'blob' as const, type: 'local' },
                { category: 'compaction' as const, type: 'reactive-overflow' },
            ];

            for (const { category, type } of requiredProviders) {
                const exists = hasProvider(category, type);
                expect(exists).toBe(true);
            }
        });

        it('should support UI scenario: display provider options with metadata', () => {
            const blobProviders = getProvidersByCategory('blob');

            // Verify we can build a UI from provider data
            const uiOptions = blobProviders.map((provider) => ({
                id: provider.type,
                label: provider.metadata?.displayName || provider.type,
                description: provider.metadata?.description || 'No description',
            }));

            expect(uiOptions.length).toBeGreaterThanOrEqual(2);

            // Verify all UI options have required fields
            for (const option of uiOptions) {
                expect(option.id).toBeTruthy();
                expect(option.label).toBeTruthy();
                expect(option.description).toBeTruthy();
            }
        });

        it('should support provider selection scenario: find best available provider', () => {
            const blobProviders = getProvidersByCategory('blob');

            // Scenario: Select first cloud provider, fallback to local
            const cloudProvider = blobProviders.find((p) => p.metadata?.requiresNetwork === true);

            const selectedProvider = cloudProvider?.type || 'local';

            // Should select a valid provider
            expect(hasProvider('blob', selectedProvider)).toBe(true);
        });
    });
});
