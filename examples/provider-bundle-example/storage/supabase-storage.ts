/**
 * Supabase Storage Plugin
 *
 * This plugin provides Supabase blob storage for Dexto agents.
 * It includes both the blob store implementation and the provider registration.
 */

export { SupabaseBlobStore } from './supabase-blob-store.js';
export { supabaseBlobStoreProvider } from './supabase-provider.js';
export type { SupabaseBlobStoreConfig } from './supabase-provider.js';
