/**
 * Provider Infrastructure
 *
 * This module provides:
 * 1. BaseRegistry - Generic base class for building type-safe provider registries
 * 2. Discovery API - Utilities for querying registered providers across all registries
 *
 * Useful for:
 * - Building custom provider registries with consistent behavior
 * - Debugging: See what providers are available at runtime
 * - UIs: Build dynamic interfaces that show available providers
 * - Configuration validation: Check if required providers are registered
 *
 * @example
 * ```typescript
 * import { BaseRegistry, listAllProviders, hasProvider } from '@dexto/core';
 *
 * // Create a custom registry
 * class MyRegistry extends BaseRegistry<MyProvider> {
 *   constructor() {
 *     super(myErrorFactory);
 *   }
 * }
 *
 * // List all providers
 * const providers = listAllProviders();
 * console.log('Blob providers:', providers.blob);
 * ```
 */

export * from './base-registry.js';
export * from './discovery.js';
