/**
 * Local Development Image
 *
 * A convention-based image that demonstrates building custom providers on top of core.
 *
 * Pre-configured for local agent development with:
 * - SQLite database (persistent, local)
 * - Local filesystem blob storage (from core)
 * - In-memory caching
 * - Custom text utilities tool (built-in custom provider)
 * - Offline-capable
 *
 * This image demonstrates the convention-based approach:
 * - Providers are auto-discovered from providers/* folders
 * - No manual registration needed
 * - Just define metadata and defaults here
 */

import { defineImage } from '@dexto/core';

export default defineImage({
    name: 'image-local',
    version: '1.0.0',
    description: 'Local development image with filesystem storage and custom text utilities',
    target: 'local-development',

    // Providers are AUTO-DISCOVERED from category folders:
    //   tools/text-utils/index.ts (auto-registered)
    //
    // Built-in providers from core (registered via manual function):
    //   - local blob storage (from @dexto/core)
    //   - in-memory blob storage (from @dexto/core)
    //   - sqlite database (factory-based, no registration needed)
    //   - in-memory cache (factory-based, no registration needed)
    providers: {
        // Manual registration for built-in core providers
        // (These come from core, not from our providers/ folder)
        // TODO: This is a hack to get the local blob store provider to work. Should be auto-registered or dealt with in a better way.
        blobStore: {
            register: async () => {
                const { localBlobStoreProvider, inMemoryBlobStoreProvider } = await import(
                    '@dexto/core'
                );
                const { blobStoreRegistry } = await import('@dexto/core');

                blobStoreRegistry.register(localBlobStoreProvider);
                blobStoreRegistry.register(inMemoryBlobStoreProvider);

                console.log('✓ Registered core blob storage providers: local, in-memory');
            },
        },
    },

    // Default configuration values
    defaults: {
        storage: {
            blob: {
                type: 'local',
                storePath: './data/blobs',
            },
            database: {
                type: 'sqlite',
                path: './data/agent.db',
            },
            cache: {
                type: 'in-memory',
            },
        },
        logging: {
            level: 'info',
            fileLogging: true,
        },
    },

    // Runtime constraints
    constraints: ['filesystem-required', 'offline-capable'],
});
