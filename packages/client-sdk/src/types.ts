// Lightweight client SDK types - simple interfaces, no validation
// Let the server handle all validation and return appropriate errors

// Basic configuration types
export interface ClientConfig {
    baseUrl: string;
    apiKey?: string | undefined;
    timeout?: number | undefined;
    retries?: number | undefined;
}

export interface ClientOptions {
    enableWebSocket?: boolean | undefined;
    reconnect?: boolean | undefined;
    reconnectInterval?: number | undefined;
    debug?: boolean | undefined;
}

// Message types
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

// Session types
export interface SessionInfo {
    id: string;
    name?: string;
    description?: string;
    createdAt: string;
    updatedAt: string;
    agentId: string;
    userId?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
}

// LLM types
export interface LLMConfig {
    provider: string;
    model: string;
    router?: string;
    apiKey?: string;
    baseUrl?: string;
    maxTokens?: number;
    maxInputTokens?: number;
    maxOutputTokens?: number;
    maxIterations?: number;
    temperature?: number;
    displayName?: string;
}

export interface ClientProviderInfo {
    name: string;
    models: string[];
    supportedRouters: string[];
    supportsBaseURL: boolean;
    hasApiKey?: boolean;
    primaryEnvVar?: string;
}

// MCP types
export interface McpServer {
    id: string;
    name: string;
    status: 'connected' | 'disconnected' | 'error' | 'unknown';
    error?: string;
}

export interface Tool {
    id: string;
    name: string;
    description: string;
    inputSchema?: Record<string, unknown>;
}

// Search types
export interface SearchOptions {
    limit?: number;
    offset?: number;
    sessionId?: string;
    role?: 'user' | 'assistant' | 'system' | 'tool';
}

export interface SearchResult {
    id: string;
    content: string;
    metadata: Record<string, unknown>;
    score: number;
    type: string;
}

export interface SearchResponse {
    results: SearchResult[];
    total: number;
    hasMore: boolean;
}

export interface SessionSearchResult extends SearchResult {
    sessionId: string;
    sessionName?: string;
}

export interface SessionSearchResponse {
    results: SessionSearchResult[];
    total: number;
    hasMore: boolean;
}

// Catalog types
export interface CatalogOptions {
    provider?: string;
    hasKey?: boolean;
    router?: 'vercel' | 'in-built';
    fileType?: 'audio' | 'pdf' | 'image' | 'text';
    defaultOnly?: boolean;
    mode?: 'grouped' | 'flat';
}

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

// Event types
export interface AgentEventMap {
    'agent:started': { agentId: string; timestamp: string };
    'agent:stopped': { agentId: string; timestamp: string };
    'agent:error': { agentId: string; error: string; timestamp: string };
    'agent:message': { agentId: string; message: string; timestamp: string };
}

export interface SessionEventMap {
    'session:created': { sessionId: string; agentId: string; timestamp: string };
    'session:updated': { sessionId: string; changes: Record<string, unknown>; timestamp: string };
    'session:deleted': { sessionId: string; timestamp: string };
    'session:message': { sessionId: string; message: string; timestamp: string };
}

export type DextoEvent =
    | {
          [K in keyof AgentEventMap]: {
              type: K;
              data: AgentEventMap[K];
          };
      }[keyof AgentEventMap]
    | {
          [K in keyof SessionEventMap]: {
              type: K;
              data: SessionEventMap[K];
              sessionId: string;
          };
      }[keyof SessionEventMap];
