// Client SDK types that extend core types for client-specific needs
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
export interface LLMConfig {
    provider: string; // Use string for API compatibility, can be cast to LLMProvider when needed
    model: string;
    router?: string; // Use string for API compatibility, can be cast to LLMRouter when needed
    apiKey?: string;
    baseUrl?: string;
    baseURL?: string; // Alternative naming for consistency
    maxTokens?: number;
    maxInputTokens?: number;
    maxOutputTokens?: number;
    maxIterations?: number;
    temperature?: number;
    displayName?: string;
}

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
    inputSchema?: any;
}

export interface SearchOptions {
    limit?: number;
    offset?: number;
    sessionId?: string;
    role?: 'user' | 'assistant' | 'system' | 'tool';
}

export interface SearchResult {
    sessionId: string;
    message?: InternalMessage; // Use core InternalMessage type
    matchedText?: string;
    context?: string;
    messageIndex?: number;
    // Allow additional fields for backward compatibility
    id?: string;
    content?: string;
    role?: string;
    timestamp?: number;
}

export interface SearchResponse {
    results: SearchResult[];
    total: number;
    hasMore: boolean;
    query?: string;
    options?: {
        sessionId?: string;
        role?: 'user' | 'assistant' | 'system' | 'tool';
        limit?: number;
        offset?: number;
    };
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
    // Allow backward compatibility with old structure
    sessions?: {
        id: string;
        messageCount: number;
        lastActivity: number;
        createdAt: number;
    }[];
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
export interface CatalogModel {
    name: string;
    displayName?: string;
    default?: boolean;
    maxInputTokens: number;
    supportedFileTypes: string[]; // Use string[] for API compatibility
    supportedRouters?: string[]; // Use string[] for API compatibility
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
    supportedRouters: string[]; // Use string[] for API compatibility
    supportsBaseURL: boolean;
    models: CatalogModel[];
    supportedFileTypes?: string[]; // Use string[] for API compatibility
}

export interface CatalogResponse {
    providers?: Record<string, CatalogProvider>;
    models?: Array<CatalogModel & { provider: string }>;
}

// Event types for WebSocket communication
export interface DextoEvent {
    type: string;
    data: any;
    sessionId?: string;
}

export interface ClientOptions {
    enableWebSocket?: boolean;
    reconnect?: boolean;
    reconnectInterval?: number;
    debug?: boolean;
}

// Error types
export class DextoClientError extends Error {
    constructor(
        message: string,
        public statusCode?: number,
        public details?: any
    ) {
        super(message);
        this.name = 'DextoClientError';
    }
}

export class DextoNetworkError extends DextoClientError {
    constructor(
        message: string,
        public originalError?: Error
    ) {
        super(message, 0);
        this.name = 'DextoNetworkError';
    }
}

export class DextoValidationError extends DextoClientError {
    constructor(
        message: string,
        public validationErrors: any[] = []
    ) {
        super(message, 400);
        this.name = 'DextoValidationError';
    }
}
