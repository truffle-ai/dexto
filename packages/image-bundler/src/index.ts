/**
 * @dexto/bundler
 *
 * Bundles Dexto base images from dexto.image.ts definitions
 * into importable packages with side-effect provider registration.
 */

export { bundle } from './bundler.js';
export type { BundleOptions, BundleResult, GeneratedCode } from './types.js';
