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

    // Extend the base image - bundler will import it for side-effect registration
    // This automatically inherits all providers from the base image
    extends: '@dexto/image-local',

    // Providers are AUTO-DISCOVERED from:
    //   tools/weather-helper/index.ts
    //
    // Combined with inherited providers from base image (via extends):
    //   - local blob storage
    //   - in-memory blob storage
    //   - text-utils tool
    //   - sqlite database
    //   - in-memory cache
    //
    // The bundler generates:
    //   import '../../00-building-image/dist/index.js'; // Side-effect: registers base providers
    //   // Then registers our custom providers
    providers: {
        // Provider registration happens automatically via bundler
        // Both base image providers (via extends) and our custom providers (auto-discovered)
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
