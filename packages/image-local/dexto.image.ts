/**
 * Local Development Base Image
 *
 * Pre-configured backend for local agent development with:
 * - SQLite database (persistent, local)
 * - Local filesystem blob storage
 * - In-memory caching
 * - Offline-capable
 *
 * Perfect for development, testing, and desktop applications.
 */

import { defineImage } from '@dexto/core';

export default defineImage({
    name: 'image-local',
    version: '1.0.0',
    description: 'Local development base image with filesystem-based storage',
    target: 'local-development',

    providers: {
        // Blob storage providers (uses existing registry)
        blobStore: {
            register: async () => {
                const { blobStoreRegistry } = await import('@dexto/core');
                const { localBlobProvider, inMemoryBlobProvider } = await import(
                    './src/providers/blob.js'
                );

                blobStoreRegistry.register(localBlobProvider);
                blobStoreRegistry.register(inMemoryBlobProvider);

                console.log('✓ Registered blob storage providers: local, in-memory');
            },
        },

        // Database providers (uses factory pattern in core)
        // SQLite and in-memory are already available via factory
        database: {
            register: async () => {
                console.log('✓ Database providers available: sqlite, in-memory');
            },
        },

        // Cache providers (uses factory pattern in core)
        // In-memory and Redis are already available via factory
        cache: {
            register: async () => {
                console.log('✓ Cache providers available: in-memory, redis');
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
