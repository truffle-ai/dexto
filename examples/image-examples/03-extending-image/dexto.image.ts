/**
 * Example 3: Extending an Image (TRUE EXTENSION)
 *
 * This demonstrates creating a NEW IMAGE that extends an existing base image.
 *
 * Key Difference from Runtime Customization:
 * - This BUILDS A NEW IMAGE (with bundler)
 * - Creates a distributable package with base + extensions
 * - Perfect for creating organization-specific images
 * - Can be published to npm and shared across teams
 *
 * Use Case: You want to create @myorg/image-weather that includes
 * everything from @dexto/image-local PLUS your weather tool, and
 * share it across multiple apps in your organization.
 */

import { defineImage } from '@dexto/core';

export default defineImage({
    name: 'image-weather',
    version: '1.0.0',
    description: 'Extended image with weather capabilities built on image-local',
    target: 'local-development',

    // TODO: The 'extends' field is conceptually shown here but may need
    // bundler implementation to fully work. For now, this demonstrates
    // the pattern and structure.
    //
    // When extends is implemented, the bundler would:
    // 1. Import the base image's providers
    // 2. Register them automatically
    // 3. Add our custom providers on top
    //
    // extends: '@dexto/image-local',

    // Providers are AUTO-DISCOVERED from:
    //   tools/weather-helper/index.ts
    //
    // Combined with inherited providers from base:
    //   - local blob storage
    //   - in-memory blob storage
    //   - text-utils tool
    //   - sqlite database
    //   - in-memory cache
    providers: {
        // Manual registration for base image providers (until extends is implemented)
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
        customTools: {
            register: async () => {
                // Register text-utils from base image manually
                // TODO: When extends is implemented, this would be automatic
                const textUtilsModule = await import(
                    '../../00-building-image/dist/tools/text-utils/index.js'
                );
                const { customToolRegistry } = await import('@dexto/core');

                for (const exported of Object.values(textUtilsModule)) {
                    if (
                        exported &&
                        typeof exported === 'object' &&
                        'type' in exported &&
                        'create' in exported
                    ) {
                        customToolRegistry.register(exported as any);
                    }
                }

                console.log('✓ Registered text-utils from base image');
            },
        },
    },

    // Default configuration values (inherits + overrides base)
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

    // Runtime constraints (inherits from base)
    constraints: ['filesystem-required', 'offline-capable'],
});
