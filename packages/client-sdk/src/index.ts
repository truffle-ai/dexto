// Public SDK API
export * from './client.js';
export * from './types.js';
export * from './schemas.js';

// Re-export core search types to avoid drift.
// Prefer these for strong typing when integrating directly with core semantics.
export type {
    SearchOptions as CoreSearchOptions,
    SearchResult as CoreSearchResult,
    SessionSearchResult as CoreSessionSearchResult,
    SearchResponse as CoreSearchResponse,
    SessionSearchResponse as CoreSessionSearchResponse,
} from '@dexto/core';
