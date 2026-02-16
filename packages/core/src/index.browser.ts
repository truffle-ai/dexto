// Browser-safe root exports for @dexto/core
// Export only what's actually used by client packages (webui, cli, client-sdk)

// Runtime utilities (actually used by client packages)
export { toError } from './utils/error-conversion.js'; // Used by webui package
export { zodToIssues } from './utils/result.js'; // Used by client-sdk package
export { EnvExpandedString } from './utils/result.js'; // Used by @dexto/storage schemas in browser bundles
export { ErrorScope, ErrorType } from './errors/types.js'; // Used by client-sdk package

// Type-only exports (used as types, no runtime overhead)
export type { Issue, Severity, DextoErrorCode } from './errors/types.js';

// Context/message types (used by webui package)
export type {
    InternalMessage,
    SystemMessage,
    UserMessage,
    AssistantMessage,
    ToolMessage,
    TextPart,
    FilePart,
    ImageData,
    FileData,
    UIResourcePart,
    ContentPart,
    ToolCall,
    ToolApprovalStatus,
} from './context/types.js';
// Note: ImagePart not exported - only used internally in core package

// Message type guards (used by CLI and webui packages)
export {
    isSystemMessage,
    isUserMessage,
    isAssistantMessage,
    isToolMessage,
    isTextPart,
    isImagePart,
    isFilePart,
    isUIResourcePart,
} from './context/types.js';

// Context utilities (used by webui package for media kind detection)
export { getFileMediaKind, getResourceKind } from './context/media-helpers.js';

// LLM types (used by client packages)
export type { LLMProvider } from './llm/types.js';
export { LLM_PROVIDERS } from './llm/types.js';

// MCP types and constants (used by webui)
export type { McpServerType, McpConnectionMode } from './mcp/schemas.js';
export {
    MCP_SERVER_TYPES,
    MCP_CONNECTION_MODES,
    DEFAULT_MCP_CONNECTION_MODE,
} from './mcp/schemas.js';

// Storage errors (used by @dexto/storage schemas in browser bundles)
export { StorageErrorCode } from './storage/error-codes.js';

// Tool permissions types and constants (used by webui)
export type { PermissionsMode, AllowedToolsStorageType } from './tools/schemas.js';
export {
    PERMISSIONS_MODES,
    ALLOWED_TOOLS_STORAGE_TYPES,
    DEFAULT_PERMISSIONS_MODE,
    DEFAULT_ALLOWED_TOOLS_STORAGE,
} from './tools/schemas.js';

// Approval types and constants (used by webui)
export { ApprovalStatus, ApprovalType, DenialReason } from './approval/types.js';
export type { ApprovalRequest, ApprovalResponse } from './approval/types.js';

// Session types (used by CLI package)
export type { SessionMetadata } from './session/session-manager.js';

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
export type { ModelInfo, ProviderInfo } from './llm/registry/index.js';
export type { SupportedFileType } from './llm/types.js';

// Resource types and utilities (used by webui package)
// Note: Only export browser-safe reference parsing functions, NOT ResourceManager
// (ResourceManager requires logger which has Node.js dependencies)
export type { ResourceMetadata } from './resources/types.js';
export type { ResourceReference } from './resources/reference-parser.js';
export {
    parseResourceReferences,
    resolveResourceReferences,
} from './resources/reference-parser.js';
