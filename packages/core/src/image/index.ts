/**
 * Base Image Infrastructure
 *
 * Provides types and helpers for defining Dexto base images.
 * Base images are pre-configured backend surfaces that bundle providers,
 * utilities, and defaults for specific deployment targets.
 *
 * @example Creating a base image
 * ```typescript
 * // dexto.image.ts
 * import { defineImage } from '@dexto/core';
 *
 * export default defineImage({
 *   name: 'local',
 *   version: '1.0.0',
 *   description: 'Local development base image',
 *   target: 'local-development',
 *
 *   providers: {
 *     blobStore: {
 *       providers: [localBlobProvider],
 *     },
 *     database: {
 *       register: async () => {
 *         const { sqliteProvider } = await import('./providers/database.js');
 *         databaseRegistry.register(sqliteProvider);
 *       },
 *     },
 *   },
 *
 *   defaults: {
 *     storage: {
 *       blob: { type: 'local', storePath: './data/blobs' },
 *       database: { type: 'sqlite', path: './data/agent.db' },
 *     },
 *   },
 *
 *   constraints: ['filesystem-required', 'offline-capable'],
 * });
 * ```
 *
 * @example Using a base image
 * ```typescript
 * // my-app/src/index.ts
 * import { createAgent, enrichConfigForLocal } from '@dexto/image-local';
 *
 * const config = enrichConfigForLocal(rawConfig);
 * const agent = createAgent(config); // Providers already registered!
 * ```
 */

// Core types
export type {
    ImageProvider,
    ProviderMetadata,
    ProviderRegistrationFn,
    ProviderCategoryConfig,
    ImageDefinition,
    ImageTarget,
    ImageConstraint,
    ImageDefaults,
    ImageMetadata,
    ImageBuildResult,
    ImageBuildOptions,
} from './types.js';

// Definition helpers
export { defineImage, defineProviderCategory, validateImageDefinition } from './define-image.js';
