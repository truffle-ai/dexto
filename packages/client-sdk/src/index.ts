/**
 * Dexto Client SDK
 * Lightweight type-safe client for Dexto API built on Hono's typed client
 */

// Core client
export { createDextoClient } from './client.js';
export type { DextoClient } from './client.js';

// SSE streaming
export { EventStreamClient, SSEError } from './streaming.js';
export type { SSEEvent } from './streaming.js';

// Types (re-exported from core/server)
export type {
    // Client config
    ClientConfig,
    // Server types
    AppType,
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
} from './types.js';
