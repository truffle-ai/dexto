/**
 * @dexto/bundler
 *
 * Bundles Dexto base images from dexto.image.ts definitions
 * into importable packages exporting a typed `DextoImageModule` (no side effects).
 */

export { bundle } from './bundler.js';
export type { BundleOptions, BundleResult, GeneratedCode } from './types.js';
export type { ImageDefinition, ImageDefaults, ImageMetadata } from './image-definition/types.js';
