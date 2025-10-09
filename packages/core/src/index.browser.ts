// Browser-safe root exports for @dexto/core
// Export only what's actually used by client packages (webui, cli, client-sdk)

// Runtime utilities (actually used by client packages)
export { toError } from './utils/error-conversion.js'; // Used by webui package
export { zodToIssues } from './utils/result.js'; // Used by client-sdk package
export { ErrorScope, ErrorType } from './errors/types.js'; // Used by client-sdk package

// Type-only exports (used as types, no runtime overhead)
export type { Issue, Severity, DextoErrorCode } from './errors/types.js';

// Context/message types (used by webui package)
export type { InternalMessage, TextPart, FilePart, ImageData, FileData } from './context/types.js';
// Note: ImagePart not exported - only used internally in core package

// LLM types (used by client packages)
export type { LLMProvider, LLMRouter } from './llm/types.js';
export { LLM_PROVIDERS, LLM_ROUTERS } from './llm/types.js';

// MCP types and constants (used by webui)
export type { McpServerType, McpConnectionMode } from './mcp/schemas.js';
export {
    MCP_SERVER_TYPES,
    MCP_CONNECTION_MODES,
    DEFAULT_MCP_CONNECTION_MODE,
} from './mcp/schemas.js';

// Storage types and constants (used by webui)
export type { CacheType, DatabaseType } from './storage/schemas.js';
export { CACHE_TYPES, DATABASE_TYPES } from './storage/schemas.js';

// Tool confirmation types and constants (used by webui)
export type { ToolConfirmationMode, AllowedToolsStorageType } from './tools/schemas.js';
export {
    TOOL_CONFIRMATION_MODES,
    ALLOWED_TOOLS_STORAGE_TYPES,
    DEFAULT_TOOL_CONFIRMATION_MODE,
    DEFAULT_ALLOWED_TOOLS_STORAGE,
} from './tools/schemas.js';

// Session types (used by CLI package)
export type { SessionMetadata } from './session/session-manager.js';

// Agent types (used by webui for form configuration)
export type { AgentConfig, ValidatedAgentConfig } from './agent/schemas.js';

// System prompt types and constants (used by webui)
export { PROMPT_GENERATOR_SOURCES } from './systemPrompt/registry.js';
export type { ContributorConfig, SystemPromptConfig } from './systemPrompt/schemas.js';

// Search types (used by client-sdk package)
export type {
    SearchOptions,
    SearchResult,
    SessionSearchResult,
    SearchResponse,
    SessionSearchResponse,
} from './search/types.js';

// Event types (used by client-sdk package)
export type { AgentEventMap, SessionEventMap } from './events/index.js';

// LLM registry types (used by client-sdk package)
export type { ModelInfo, ProviderInfo } from './llm/registry.js';
export type { SupportedFileType } from './llm/types.js';
