import type {
    SearchOptions,
    SearchResult,
    SearchResponse,
    SessionSearchResult,
    SessionSearchResponse,
    AgentEventMap,
    SessionEventMap,
    ModelInfo,
    ProviderInfo,
    LLMProvider,
    LLMRouter,
    SupportedFileType,
    LLMConfig,
    ImageData,
    FileData,
    InternalMessage,
    SessionMetadata,
    ToolSet,
    McpServerConfig,
} from '@dexto/core';

// Re-export core types for convenience
export type {
    SearchOptions,
    SearchResult,
    SearchResponse,
    SessionSearchResult,
    SessionSearchResponse,
    AgentEventMap,
    SessionEventMap,
    ModelInfo,
    ProviderInfo,
    LLMProvider,
    LLMRouter,
    SupportedFileType,
    LLMConfig,
    ImageData,
    FileData,
    InternalMessage,
    SessionMetadata,
    ToolSet,
    McpServerConfig,
};

// Client-specific configuration types (not in core - SDK-specific concerns)
export interface ClientConfig {
    baseUrl: string;
    apiKey?: string | undefined;
    timeout?: number | undefined;
    retries?: number | undefined;
}

export interface ClientOptions {
    debug?: boolean | undefined;
}

// API-specific message types (not in core - simplified interface for external clients)
export interface MessageInput {
    content: string;
    imageData?: ImageData;
    fileData?: FileData;
    sessionId?: string;
    stream?: boolean;
}

export interface MessageResponse {
    response: string;
    sessionId: string;
}

// Type aliases for API compatibility (using core types)
export type ClientProviderInfo = ProviderInfo;
export type McpServer = McpServerConfig;
export type Tool = ToolSet;
export type CatalogModel = ModelInfo;
export type CatalogProvider = ProviderInfo;

// API-specific catalog types (not in core - client-specific query options)
export interface CatalogOptions {
    provider?: string;
    hasKey?: boolean;
    router?: LLMRouter;
    fileType?: SupportedFileType;
    defaultOnly?: boolean;
    mode?: 'grouped' | 'flat';
}

export interface CatalogResponse {
    providers?: Record<string, CatalogProvider>;
    models?: Array<CatalogModel & { provider: string }>;
}

// Combined event type for client-sdk convenience (not in core - SDK-specific union)
export type DextoEvent =
    | {
          [K in keyof AgentEventMap as K extends string ? K : never]: {
              type: K;
              data: AgentEventMap[K];
          };
      }[keyof AgentEventMap]
    | {
          [K in keyof SessionEventMap as K extends string ? K : never]: {
              type: K;
              data: SessionEventMap[K];
              sessionId: string;
          };
      }[keyof SessionEventMap];
