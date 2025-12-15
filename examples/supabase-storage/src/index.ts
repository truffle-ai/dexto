/**
 * Supabase Storage Example with Custom Tool Provider
 *
 * This module exports custom providers for Dexto agents:
 * - Supabase blob storage provider (stores blobs in Supabase Storage)
 * - DateTime Helper tool provider (custom tools for date/time operations)
 *
 * Usage in your application:
 *
 * @example
 * ```typescript
 * import { blobStoreRegistry, customToolRegistry } from '@dexto/core';
 * import { supabaseBlobStoreProvider, dateTimeToolProvider } from '@supabase-storage-example';
 *
 * // Register providers at app startup (before creating DextoAgent)
 * blobStoreRegistry.register(supabaseBlobStoreProvider);
 * customToolRegistry.register(dateTimeToolProvider);
 *
 * // Now your agent.yml can use:
 * // storage:
 * //   blob:
 * //     type: supabase
 * //     supabaseUrl: https://xxx.supabase.co
 * //     supabaseKey: your-key
 * //     bucket: dexto-blobs
 * //
 * // customTools:
 * //   - type: datetime-helper
 * //     defaultTimezone: America/New_York
 * ```
 *
 * See src/app.ts for a complete working example.
 */

// Blob storage provider
export { supabaseBlobStoreProvider } from './supabase-provider.js';
export { SupabaseBlobStore } from './supabase-blob-store.js';
export type { SupabaseBlobStoreConfig } from './supabase-provider.js';

// Custom tool provider
export { dateTimeToolProvider } from './datetime-tool-provider.js';
