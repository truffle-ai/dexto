/**
 * Provider Discovery API Example
 *
 * This example demonstrates how to use the provider discovery API
 * to list and query registered providers.
 */

import {
    listAllProviders,
    getProvidersByCategory,
    hasProvider,
    type DiscoveredProvider,
    type ProviderDiscovery,
} from '@dexto/core';

// Example 1: List all providers
console.log('=== Example 1: List All Providers ===\n');
const allProviders: ProviderDiscovery = listAllProviders();

console.log('Blob Storage Providers:');
allProviders.blob.forEach((provider: DiscoveredProvider) => {
    const name = provider.metadata?.displayName || provider.type;
    const desc = provider.metadata?.description || 'No description';
    console.log(`  - ${name} (${provider.type})`);
    console.log(`    ${desc}`);
});

console.log('\nCompression Providers:');
allProviders.compression.forEach((provider: DiscoveredProvider) => {
    const name = provider.metadata?.displayName || provider.type;
    const desc = provider.metadata?.description || 'No description';
    console.log(`  - ${name} (${provider.type})`);
    console.log(`    ${desc}`);
});

console.log('\nCustom Tool Providers:');
if (allProviders.customTools.length === 0) {
    console.log('  (none registered)');
} else {
    allProviders.customTools.forEach((provider: DiscoveredProvider) => {
        const name = provider.metadata?.displayName || provider.type;
        const desc = provider.metadata?.description || 'No description';
        console.log(`  - ${name} (${provider.type})`);
        console.log(`    ${desc}`);
    });
}

// Example 2: Query providers by category
console.log('\n\n=== Example 2: Query by Category ===\n');
const blobProviders = getProvidersByCategory('blob');
console.log(`Found ${blobProviders.length} blob storage providers:`);
blobProviders.forEach((p) => console.log(`  - ${p.type}`));

// Example 3: Check if specific providers exist
console.log('\n\n=== Example 3: Check Provider Existence ===\n');

const checksToPerform = [
    { category: 'blob' as const, type: 'local', expected: true },
    { category: 'blob' as const, type: 'in-memory', expected: true },
    { category: 'blob' as const, type: 's3', expected: false },
    { category: 'compression' as const, type: 'reactive-overflow', expected: true },
    { category: 'compression' as const, type: 'noop', expected: true },
    { category: 'customTools' as const, type: 'my-custom-tool', expected: false },
];

for (const { category, type, expected } of checksToPerform) {
    const exists = hasProvider(category, type);
    const status = exists ? '✓' : '✗';
    const expectedStatus = exists === expected ? '(as expected)' : '(unexpected!)';
    console.log(`${status} ${category}/${type}: ${exists} ${expectedStatus}`);
}

// Example 4: Validation scenario
console.log('\n\n=== Example 4: Configuration Validation ===\n');

interface AppConfig {
    storage: { type: string };
    compression: { type: string };
}

const config: AppConfig = {
    storage: { type: 'local' },
    compression: { type: 'reactive-overflow' },
};

function validateConfig(cfg: AppConfig): void {
    console.log('Validating configuration...');

    if (!hasProvider('blob', cfg.storage.type)) {
        throw new Error(`Blob storage provider '${cfg.storage.type}' is not available`);
    }
    console.log(`✓ Storage provider '${cfg.storage.type}' is available`);

    if (!hasProvider('compression', cfg.compression.type)) {
        throw new Error(`Compression provider '${cfg.compression.type}' is not available`);
    }
    console.log(`✓ Compression provider '${cfg.compression.type}' is available`);

    console.log('Configuration is valid!');
}

try {
    validateConfig(config);
} catch (error) {
    console.error('Configuration validation failed:', error);
}

// Example 5: Build provider selection UI
console.log('\n\n=== Example 5: Provider Selection UI ===\n');

function buildProviderOptions(category: 'blob' | 'compression' | 'customTools') {
    const providers = getProvidersByCategory(category);

    return providers.map((provider) => ({
        id: provider.type,
        label: provider.metadata?.displayName || provider.type,
        description: provider.metadata?.description || 'No description',
        metadata: provider.metadata,
    }));
}

const blobOptions = buildProviderOptions('blob');
console.log('Blob Storage Options for UI:');
blobOptions.forEach((option) => {
    console.log(`  [${option.id}]`);
    console.log(`    Label: ${option.label}`);
    console.log(`    Description: ${option.description}`);
});

// Example 6: Dynamic provider selection
console.log('\n\n=== Example 6: Dynamic Provider Selection ===\n');

function selectBestBlobProvider(): string {
    const providers = getProvidersByCategory('blob');

    // Strategy: Prefer cloud storage, fallback to local
    const cloudProvider = providers.find((p) => p.metadata?.requiresNetwork === true);

    if (cloudProvider) {
        console.log(`Selected cloud provider: ${cloudProvider.type}`);
        return cloudProvider.type;
    }

    // Fallback to local
    const localProvider = providers.find((p) => p.type === 'local');
    if (localProvider) {
        console.log(`Selected local provider: ${localProvider.type}`);
        return localProvider.type;
    }

    // Last resort: in-memory
    console.log('Selected fallback provider: in-memory');
    return 'in-memory';
}

const selectedProvider = selectBestBlobProvider();
console.log(`\nFinal selection: ${selectedProvider}`);

// Example 7: Statistics
console.log('\n\n=== Example 7: Provider Statistics ===\n');

const stats = {
    totalProviders:
        allProviders.blob.length +
        allProviders.compression.length +
        allProviders.customTools.length,
    blobProviders: allProviders.blob.length,
    compressionProviders: allProviders.compression.length,
    customToolProviders: allProviders.customTools.length,
};

console.log('Provider Registry Statistics:');
console.log(`  Total Providers: ${stats.totalProviders}`);
console.log(`  Blob Storage: ${stats.blobProviders}`);
console.log(`  Compression: ${stats.compressionProviders}`);
console.log(`  Custom Tools: ${stats.customToolProviders}`);
