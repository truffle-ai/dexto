// Client SDK types where we intentionally keep API-facing shapes flexible.
// Wherever possible, prefer importing types from @dexto/core to avoid drift.
// The types below are kept relaxed (string-based, optional fields) because
// they mirror HTTP responses and inputs exposed by the public API.
// We re-export core types in index.ts for strong typing when needed.
// Import core types for re-export
import type { InternalMessage } from '@dexto/core';

export interface ClientConfig {
    baseUrl: string;
    apiKey?: string;
    timeout?: number;
    retries?: number;
}

export interface MessageInput {
    content: string;
    imageData?: {
        base64: string;
        mimeType: string;
    };
    fileData?: {
        base64: string;
        mimeType: string;
        filename?: string;
    };
    sessionId?: string;
    stream?: boolean;
}

export interface MessageResponse {
    response: string;
    sessionId: string;
}

export interface SessionInfo {
    id: string;
    createdAt: number;
    lastActivity: number;
    messageCount: number;
}

// Re-export core LLM types
export type { LLMProvider, LLMRouter, ModelInfo, SupportedFileType } from '@dexto/core';

// Client-specific LLM config that extends core types
// Note: provider and router use string types for API compatibility
// Intentionally relaxed: client-side LLMConfig keeps strings for provider/router
// to match wire formats and allow looser API inputs.
export interface LLMConfig {
    provider: string; // Use string for API compatibility, can be cast to LLMProvider when needed
    model: string;
    router?: string | undefined; // Use string for API compatibility, can be cast to LLMRouter when needed
    apiKey?: string | undefined;
    baseUrl?: string | undefined;
    baseURL?: string | undefined; // Alternative naming for consistency
    maxTokens?: number | undefined;
    maxInputTokens?: number | undefined;
    maxOutputTokens?: number | undefined;
    maxIterations?: number | undefined;
    temperature?: number | undefined;
    displayName?: string | undefined;
}

// Intentionally minimal: surface only API response fields for MCP server status
export interface McpServer {
    id: string;
    name: string;
    status: 'connected' | 'disconnected' | 'error' | 'unknown';
    error?: string | undefined;
}

// Intentionally minimal: matches API response shape for tools listing
export interface Tool {
    id: string;
    name: string;
    description: string;
    inputSchema?: Record<string, unknown> | undefined;
}

// Intentionally relaxed: SDK exposes flexible search options for API usage.
// For stricter types, import CoreSearchOptions from '@dexto/core'.
export interface SearchOptions {
    limit?: number;
    offset?: number;
    sessionId?: string;
    role?: 'user' | 'assistant' | 'system' | 'tool';
}

// Intentionally relaxed: many fields optional to align with API response variances.
// For stricter types, import CoreSearchResult from '@dexto/core'.
export interface SearchResult {
    sessionId: string;
    message?: InternalMessage | undefined; // Use core InternalMessage type
    matchedText?: string | undefined;
    context?: string | undefined;
    messageIndex?: number | undefined;
    // Allow additional fields for backward compatibility
    id?: string | undefined;
    content?: string | undefined;
    role?: string | undefined;
    timestamp?: number | undefined;
}

// Intentionally relaxed response shape to tolerate API additions.
// For stricter types, import CoreSearchResponse from '@dexto/core'.
export interface SearchResponse {
    results: SearchResult[];
    total: number;
    hasMore: boolean;
    query?: string | undefined;
    options?:
        | {
              sessionId?: string | undefined;
              role?: 'user' | 'assistant' | 'system' | 'tool' | undefined;
              limit?: number | undefined;
              offset?: number | undefined;
          }
        | undefined;
}

// Intentionally relaxed: allows optional firstMatch/sessions for backward compatibility.
// For stricter types, import CoreSessionSearchResponse from '@dexto/core'.
export interface SessionSearchResponse {
    results: {
        sessionId: string;
        matchCount: number;
        firstMatch?: SearchResult | undefined;
        metadata: {
            createdAt: number;
            lastActivity: number;
            messageCount: number;
        };
    }[];
    total: number;
    hasMore: boolean;
    query?: string | undefined;
    // Allow backward compatibility with old structure
    sessions?:
        | {
              id: string;
              messageCount: number;
              lastActivity: number;
              createdAt: number;
          }[]
        | undefined;
}

// LLM Catalog types
export interface CatalogOptions {
    provider?: string;
    hasKey?: boolean;
    router?: string;
    fileType?: string;
    defaultOnly?: boolean;
    mode?: 'grouped' | 'flat';
}

// Client-specific model info that's more flexible for API responses
// Intentionally relaxed: catalog reflects API payloads (string unions, optional pricing fields).
export interface CatalogModel {
    name: string;
    displayName?: string | undefined;
    default?: boolean | undefined;
    maxInputTokens: number;
    supportedFileTypes: string[]; // Use string[] for API compatibility
    supportedRouters?: string[] | undefined; // Use string[] for API compatibility
    pricing?:
        | {
              inputPerM?: number | undefined;
              outputPerM?: number | undefined;
              cacheReadPerM?: number | undefined;
              cacheWritePerM?: number | undefined;
              currency?: 'USD' | undefined;
              unit?: 'per_million_tokens' | undefined;
          }
        | undefined;
}

// Intentionally relaxed: mirrors API provider payload.
export interface CatalogProvider {
    name: string;
    hasApiKey: boolean;
    primaryEnvVar: string;
    supportedRouters: string[]; // Use string[] for API compatibility
    supportsBaseURL: boolean;
    models: CatalogModel[];
    supportedFileTypes?: string[] | undefined; // Use string[] for API compatibility
}

// Intentionally relaxed: mirrors API response where providers/models can be omitted.
export interface CatalogResponse {
    providers?: Record<string, CatalogProvider> | undefined;
    models?: Array<CatalogModel & { provider: string }> | undefined;
}

// Event types for WebSocket communication
export interface DextoEvent {
    type: string;
    data: unknown;
    sessionId?: string | undefined;
}

export interface ClientOptions {
    enableWebSocket?: boolean | undefined;
    reconnect?: boolean | undefined;
    reconnectInterval?: number | undefined;
    debug?: boolean | undefined;
}
