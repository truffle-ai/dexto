/**
 * Local Development Image
 *
 * Pre-configured base image for local agent development with:
 * - SQLite database (persistent, local)
 * - Local filesystem blob storage
 * - In-memory caching
 * - FileSystem tools (read, write, edit, glob, grep)
 * - Process tools (bash exec, output, kill)
 * - Offline-capable
 *
 * Tools are automatically registered when this image is imported.
 * Services are initialized on-demand when tools are used.
 */

import { defineImage } from '@dexto/core';

export default defineImage({
    name: 'image-local',
    version: '1.0.0',
    description: 'Local development image with filesystem and process tools',
    target: 'local-development',

    // Provider registration
    // These providers are registered as side-effects when the image is imported
    providers: {
        // Blob storage providers from core
        blobStore: {
            register: async () => {
                const { localBlobStoreProvider, inMemoryBlobStoreProvider } = await import(
                    '@dexto/core'
                );
                const { blobStoreRegistry } = await import('@dexto/core');

                blobStoreRegistry.register(localBlobStoreProvider);
                blobStoreRegistry.register(inMemoryBlobStoreProvider);

                console.log('✓ Registered blob storage providers: local, in-memory');
            },
        },

        // Custom tool providers from separate packages
        customTools: {
            register: async () => {
                const { fileSystemToolsProvider } = await import('@dexto/tools-filesystem');
                const { processToolsProvider } = await import('@dexto/tools-process');
                const { agentSpawnerToolsProvider } = await import('@dexto/agent-management');
                const { todoToolsProvider } = await import('@dexto/tools-todo');
                const { customToolRegistry } = await import('@dexto/core');

                customToolRegistry.register(fileSystemToolsProvider);
                customToolRegistry.register(processToolsProvider);
                customToolRegistry.register(agentSpawnerToolsProvider);
                customToolRegistry.register(todoToolsProvider);

                console.log(
                    '✓ Registered tool providers: filesystem-tools, process-tools, agent-spawner, todo-tools'
                );
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
        // Default custom tools configuration
        // Users can add these to their config to enable filesystem and process tools
        customTools: [
            {
                type: 'filesystem-tools',
                allowedPaths: ['.'],
                blockedPaths: ['.git', 'node_modules/.bin', '.env'],
                blockedExtensions: ['.exe', '.dll', '.so'],
                enableBackups: false,
            },
            {
                type: 'process-tools',
                securityLevel: 'moderate',
            },
            {
                type: 'todo-tools',
            },
        ],
    },

    // Runtime constraints
    constraints: ['filesystem-required', 'offline-capable'],
});
