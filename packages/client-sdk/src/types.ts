// Client SDK types derived from @dexto/core to eliminate drift.
// Most types are imported directly from core or derived from schemas.
// Only wire-format specific types (like LLMConfig) differ from core for API compatibility.
//
// IMPORTANT: We use 'import type' for all core imports to avoid runtime dependencies.
// This ensures the client SDK is truly a thin wrapper that works in all environments
// (Node.js, browser, mobile) without pulling in Node.js-specific code.
//
// Why we don't need browser-safe exports for these types:
// - Type-only imports are completely stripped at runtime (no JavaScript generated)
// - No runtime dependencies are pulled in
// - Works universally across all environments
// - Keeps bundle size minimal
import type {
    SessionMetadata, // Used: extends SessionInfo interface
    SearchOptions as CoreSearchOptions, // Used: API parameter types
    SearchResult as CoreSearchResult, // Used: API response types
    LLMProvider, // Used: enum for type safety in LLM config
    LLMRouter, // Used: enum for type safety in LLM config
    AgentEventMap, // Used: WebSocket event types for real-time updates
    SessionEventMap, // Used: WebSocket event types for real-time updates
} from '@dexto/core';

// Import schemas for type derivation
import type {
    ClientConfigSchema,
    ClientOptionsSchema,
    MessageInputSchema,
    CatalogOptionsSchema,
    McpServerSchema,
    ToolSchema,
} from './schemas.js';
import type { z } from 'zod';

// Derive types from Zod schemas to eliminate duplication
// Input types (for constructor parameters) - before defaults applied
export type ClientConfigInput = z.input<typeof ClientConfigSchema>;
export type ClientOptionsInput = z.input<typeof ClientOptionsSchema>;

// Output types (for validated data) - after defaults applied
export type ClientConfig = z.output<typeof ClientConfigSchema>;
export type ClientOptions = z.output<typeof ClientOptionsSchema>;
export type MessageInput = z.infer<typeof MessageInputSchema>;

// Wire format response types (no validation, direct from API)
export interface MessageResponse {
    response: string;
    sessionId: string;
}

// Extend core SessionMetadata with id field required by API responses
export interface SessionInfo extends SessionMetadata {
    id: string;
}

// Re-export core LLM types for strong typing
// These are used by client SDK users for type safety when working with LLM configurations
export type { ModelInfo, SupportedFileType, ProviderInfo } from '@dexto/core';

// Re-export already imported core enum types
export type { LLMProvider, LLMRouter };

// Client-specific provider info type that matches the API response
export interface ClientProviderInfo {
    name: string;
    models: string[];
    supportedRouters: string[];
    supportsBaseURL: boolean;
    hasApiKey?: boolean | undefined;
    primaryEnvVar?: string | undefined;
}

// Client LLM config uses string types for wire format compatibility
export interface LLMConfig {
    provider: string; // Wire format: string, can be cast to LLMProvider
    model: string;
    router?: string | undefined; // Wire format: string, can be cast to LLMRouter
    apiKey?: string | undefined;
    baseUrl?: string | undefined;
    maxTokens?: number | undefined;
    maxInputTokens?: number | undefined;
    maxOutputTokens?: number | undefined;
    maxIterations?: number | undefined;
    temperature?: number | undefined;
    displayName?: string | undefined;
}

// Derive MCP and Tool types from schemas
export type McpServer = z.infer<typeof McpServerSchema>;
export type Tool = z.infer<typeof ToolSchema>;

// Use core SearchOptions directly
export type SearchOptions = CoreSearchOptions;

// Use core SearchResult directly
export type SearchResult = CoreSearchResult;

// Wire format search response types (no validation, direct from API)
export interface SearchResponse {
    results: SearchResult[];
    total: number;
    hasMore: boolean;
    query?: string;
    options?: SearchOptions;
}

export interface SessionSearchResponse {
    results: {
        sessionId: string;
        matchCount: number;
        firstMatch?: SearchResult;
        metadata: {
            createdAt: number;
            lastActivity: number;
            messageCount: number;
        };
    }[];
    total: number;
    hasMore: boolean;
    query?: string;
}

// Derive catalog types from schemas
export type CatalogOptions = z.infer<typeof CatalogOptionsSchema>;

// Wire format catalog response (no validation, direct from API)
export interface CatalogResponse {
    providers?: Record<string, CatalogProvider>;
    models?: Array<CatalogModel & { provider: string }>;
}

export interface CatalogModel {
    name: string;
    displayName?: string;
    default?: boolean;
    maxInputTokens: number;
    supportedFileTypes: string[];
    supportedRouters?: string[];
    pricing?: {
        inputPerM?: number;
        outputPerM?: number;
        cacheReadPerM?: number;
        cacheWritePerM?: number;
        currency?: 'USD';
        unit?: 'per_million_tokens';
    };
}

export interface CatalogProvider {
    name: string;
    hasApiKey: boolean;
    primaryEnvVar: string;
    supportedRouters: string[];
    supportsBaseURL: boolean;
    models: CatalogModel[];
    supportedFileTypes?: string[];
}

// WebSocket event types derived from core events
// Creates a union type of all possible WebSocket events with proper typing
export type DextoEvent =
    // Agent events (already include sessionId in their data)
    | {
          [K in keyof AgentEventMap]: {
              type: K;
              data: AgentEventMap[K];
          };
      }[keyof AgentEventMap]
    // Session events (need sessionId added for WebSocket transport)
    | {
          [K in keyof SessionEventMap]: {
              type: K;
              data: SessionEventMap[K];
              sessionId: string; // Required for session events over WebSocket
          };
      }[keyof SessionEventMap];

// ClientOptions is now derived from schema above
