import type { AgentErrorCode } from '@core/agent/error-codes.js';
import type { ConfigErrorCode } from '@core/config/error-codes.js';
import type { ContextErrorCode } from '@core/context/error-codes.js';
import type { LLMErrorCode } from '@core/llm/error-codes.js';
import type { MCPErrorCode } from '@core/mcp/error-codes.js';
import type { SessionErrorCode } from '@core/session/error-codes.js';
import type { StorageErrorCode } from '@core/storage/error-codes.js';
import type { ToolErrorCode } from '@core/tools/error-codes.js';

/**
 * Error scopes representing functional domains in the system
 * Each scope owns its validation and error logic
 */
export const enum ErrorScope {
    LLM = 'llm', // LLM operations, model compatibility, input validation for LLMs
    AGENT = 'agent', // Agent lifecycle, configuration
    CONFIG = 'config', // Configuration file operations, parsing, validation
    CONTEXT = 'context', // Context management, message validation, token processing
    SESSION = 'session', // Session lifecycle, management, and state
    MCP = 'mcp', // MCP server connections and protocol
    TOOLS = 'tools', // Tool execution and authorization
    STORAGE = 'storage',
}

/**
 * Error types that map directly to HTTP status codes
 * Each type represents the nature of the error
 */
export const enum ErrorType {
    USER = 'user', // 400 - bad input, config errors, validation failures
    NOT_FOUND = 'not_found', // 404 - resource doesn't exist (session, file, etc.)
    FORBIDDEN = 'forbidden', // 403 - permission denied, unauthorized
    TIMEOUT = 'timeout', // 408 - operation timed out
    RATE_LIMIT = 'rate_limit', // 429 - too many requests
    SYSTEM = 'system', // 500 - bugs, internal failures, unexpected states
    THIRD_PARTY = 'third_party', // 502 - upstream provider failures, API errors
    UNKNOWN = 'unknown', // 500 - unclassified errors, fallback
}

/**
 * Union type for all error codes across domains
 * Provides type safety for error handling
 */
export type DextoErrorCode =
    | LLMErrorCode
    | AgentErrorCode
    | ConfigErrorCode
    | ContextErrorCode
    | SessionErrorCode
    | MCPErrorCode
    | ToolErrorCode
    | StorageErrorCode;

/** Severity of an issue */
export type Severity = 'error' | 'warning';

/** Generic issue type for validation results */
export interface Issue<C = unknown> {
    code: DextoErrorCode;
    message: string;
    scope: ErrorScope; // Domain that generated this issue
    type: ErrorType; // HTTP status mapping
    severity: Severity;
    path?: Array<string | number>;
    context?: C;
}
