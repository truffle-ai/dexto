// Main exports for the Dexto Client SDK
export { DextoClient } from './client.js';
export { HttpClient } from './http-client.js';
export { WebSocketClient } from './websocket-client.js';

// Export all types
export type {
    ClientConfig,
    ClientOptions,
    MessageInput,
    MessageResponse,
    SessionInfo,
    LLMConfig,
    LLMProvider,
    McpServer,
    Tool,
    SearchOptions,
    SearchResult,
    SearchResponse,
    SessionSearchResponse,
    DextoEvent,
    CatalogOptions,
    CatalogModel,
    CatalogProvider,
    CatalogResponse,
} from './types.js';

// Export error classes
export { DextoClientError, DextoNetworkError, DextoValidationError } from './types.js';

// Export validation schemas and utilities
export * from './schemas.js';

// Export event handler types
export type { EventHandler, ConnectionStateHandler } from './websocket-client.js';

// Default export for convenience
import { DextoClient } from './client.js';
export default DextoClient;
