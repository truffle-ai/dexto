/**
 * Local Development Harness
 *
 * Pre-configured backend for local agent development with:
 * - SQLite database (persistent, local)
 * - Local filesystem blob storage
 * - In-memory caching
 * - Offline-capable
 *
 * Perfect for development, testing, and desktop applications.
 */

import { defineImage, blobStoreRegistry } from '@dexto/core';

export default defineImage({
    name: 'image-local',
    version: '1.0.0',
    description: 'Local development harness with filesystem-based storage',
    target: 'local-development',

    providers: {
        blobStore: {
            register: async () => {
                // Import built-in blob storage providers from core
                // Note: Dynamic import within the registration function
                const { localBlobStoreProvider, inMemoryBlobStoreProvider } = await import(
                    '@dexto/core'
                );

                // Register blob storage providers
                blobStoreRegistry.register(localBlobStoreProvider);
                blobStoreRegistry.register(inMemoryBlobStoreProvider);

                console.log('✓ Registered blob storage providers: local, in-memory');
            },
        },
        // Note: Database and cache use factory pattern, no registration needed
        // They are automatically available via StorageManager:
        // - Database: sqlite, in-memory (via createDatabase factory)
        // - Cache: in-memory, redis (via createCache factory)
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
