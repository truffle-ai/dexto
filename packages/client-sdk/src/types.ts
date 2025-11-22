/**
 * Type definitions for Dexto Client SDK
 * Most types are re-exported from @dexto/core and @dexto/server for single source of truth
 */

// Re-export core types
export type {
    // Session types
    SessionMetadata,
    InternalMessage,
    // LLM types
    LLMConfig,
    LLMProvider,
    LLMRouter,
    ModelInfo,
    ProviderInfo,
    SupportedFileType,
    // Data types
    ImageData,
    FileData,
    // Search types
    SearchOptions,
    SearchResult,
    SearchResponse,
    SessionSearchResult,
    SessionSearchResponse,
    // Event types
    AgentEventMap,
    SessionEventMap,
    StreamingEvent,
    // MCP types
    McpServerConfig,
    ToolSet,
} from '@dexto/core';

// Re-export server types
export type { AppType } from '@dexto/server';

/**
 * Client-specific configuration
 * These are the only types that don't exist elsewhere
 */
export interface ClientConfig {
    /** Base URL of the Dexto server */
    baseUrl: string;
    /** Optional API key for authentication */
    apiKey?: string;
}
