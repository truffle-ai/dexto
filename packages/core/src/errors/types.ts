import type { AgentErrorCode } from '@core/agent/error-codes.js';
// ConfigErrorCode has been moved to @dexto/agent-management
// Import from there if needed for error type unions
import type { ContextErrorCode } from '@core/context/error-codes.js';
import type { LLMErrorCode } from '@core/llm/error-codes.js';
import type { MCPErrorCode } from '@core/mcp/error-codes.js';
import type { SessionErrorCode } from '@core/session/error-codes.js';
import type { StorageErrorCode } from '@core/storage/error-codes.js';
import type { SystemPromptErrorCode } from '@core/systemPrompt/error-codes.js';
import type { ToolErrorCode } from '@core/tools/error-codes.js';
import type { ResourceErrorCode } from '@core/resources/error-codes.js';
import type { PromptErrorCode } from '@core/prompts/error-codes.js';
import type { ApprovalErrorCode } from '@core/approval/error-codes.js';
import type { MemoryErrorCode } from '@core/memory/error-codes.js';
import type { PluginErrorCode } from '@core/plugins/error-codes.js';
import type { TelemetryErrorCode } from '@core/telemetry/error-codes.js';

/**
 * Error scopes representing functional domains in the system
 * Each scope owns its validation and error logic
 */
export enum ErrorScope {
    LLM = 'llm', // LLM operations, model compatibility, input validation for LLMs
    AGENT = 'agent', // Agent lifecycle, configuration
    CONFIG = 'config', // Configuration file operations, parsing, validation
    CONTEXT = 'context', // Context management, message validation, token processing
    SESSION = 'session', // Session lifecycle, management, and state
    MCP = 'mcp', // MCP server connections and protocol
    TOOLS = 'tools', // Tool execution and authorization
    STORAGE = 'storage', // Storage backend operations
    LOGGER = 'logger', // Logging system operations, transports, and configuration
    SYSTEM_PROMPT = 'system_prompt', // System prompt contributors and file processing
    RESOURCE = 'resource', // Resource management (MCP/internal) discovery and access
    PROMPT = 'prompt', // Prompt management, resolution, and providers
    MEMORY = 'memory', // Memory management and storage
    PLUGIN = 'plugin', // Plugin loading, validation, and execution
    TELEMETRY = 'telemetry', // Telemetry initialization and export operations
}

/**
 * Error types that map directly to HTTP status codes
 * Each type represents the nature of the error
 */
export enum ErrorType {
    USER = 'user', // 400 - bad input, config errors, validation failures
    PAYMENT_REQUIRED = 'payment_required', // 402 - insufficient credits, billing issue
    FORBIDDEN = 'forbidden', // 403 - permission denied, unauthorized
    NOT_FOUND = 'not_found', // 404 - resource doesn't exist (session, file, etc.)
    TIMEOUT = 'timeout', // 408 - operation timed out
    CONFLICT = 'conflict', // 409 - resource conflict, concurrent operation
    RATE_LIMIT = 'rate_limit', // 429 - too many requests
    SYSTEM = 'system', // 500 - bugs, internal failures, unexpected states
    THIRD_PARTY = 'third_party', // 502 - upstream provider failures, API errors
    UNKNOWN = 'unknown', // 500 - unclassified errors, fallback
}

/**
 * Union type for all error codes across domains
 * Provides type safety for error handling
 * Note: ConfigErrorCode has been moved to @dexto/agent-management
 */
export type DextoErrorCode =
    | LLMErrorCode
    | AgentErrorCode
    | ContextErrorCode
    | SessionErrorCode
    | MCPErrorCode
    | ToolErrorCode
    | StorageErrorCode
    | SystemPromptErrorCode
    | ResourceErrorCode
    | PromptErrorCode
    | ApprovalErrorCode
    | MemoryErrorCode
    | PluginErrorCode
    | TelemetryErrorCode;

/** Severity of an issue */
export type Severity = 'error' | 'warning';

/** Generic issue type for validation results */
export interface Issue<C = unknown> {
    code: DextoErrorCode | string;
    message: string;
    scope: ErrorScope | string; // Domain that generated this issue
    type: ErrorType; // HTTP status mapping
    severity: Severity;
    path?: Array<string | number>;
    context?: C;
}
