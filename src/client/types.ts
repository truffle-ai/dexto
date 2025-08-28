// Client SDK types that mirror the core types but are client-focused
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

export interface LLMConfig {
    provider: string;
    model: string;
    router?: string;
    apiKey?: string;
    baseUrl?: string;
    baseURL?: string; // Alternative naming for consistency
    maxTokens?: number;
    temperature?: number;
}

export interface LLMProvider {
    name: string;
    models: string[];
    supportedRouters: string[];
    supportsBaseURL: boolean;
}

export interface McpServer {
    id: string;
    name: string;
    status: 'connected' | 'error';
}

export interface Tool {
    id: string;
    name: string;
    description: string;
    inputSchema: any;
}

export interface SearchOptions {
    limit?: number;
    offset?: number;
    sessionId?: string;
    role?: 'user' | 'assistant' | 'system' | 'tool';
}

export interface SearchResult {
    id: string;
    content: string;
    role: string;
    sessionId: string;
    timestamp: number;
}

export interface SearchResponse {
    results: SearchResult[];
    total: number;
    hasMore: boolean;
}

export interface SessionSearchResponse {
    sessions: {
        id: string;
        messageCount: number;
        lastActivity: number;
        createdAt: number;
    }[];
    total: number;
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
        public validationErrors: any[]
    ) {
        super(message, 400);
        this.name = 'DextoValidationError';
    }
}
