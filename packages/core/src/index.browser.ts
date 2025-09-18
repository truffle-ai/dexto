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
export { LLM_PROVIDERS } from './llm/types.js'; // Used by CLI package
// Note: LLM_ROUTERS, SUPPORTED_FILE_TYPES not exported - only used internally in core

// Session types (used by CLI package)
export type { SessionMetadata } from './session/session-manager.js';

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
