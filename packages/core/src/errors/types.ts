import type { AgentErrorCode } from '../agent/error-codes.js';
// ConfigErrorCode has been moved to @dexto/agent-management
// Import from there if needed for error type unions
import type { ContextErrorCode } from '../context/error-codes.js';
import type { LLMErrorCode } from '../llm/error-codes.js';
import type { MCPErrorCode } from '../mcp/error-codes.js';
import type { SessionErrorCode } from '../session/error-codes.js';
import type { StorageErrorCode } from '../storage/error-codes.js';
import type { SystemPromptErrorCode } from '../systemPrompt/error-codes.js';
import type { ToolErrorCode } from '../tools/error-codes.js';
import type { ResourceErrorCode } from '../resources/error-codes.js';
import type { PromptErrorCode } from '../prompts/error-codes.js';
import type { ApprovalErrorCode } from '../approval/error-codes.js';
import type { MemoryErrorCode } from '../memory/error-codes.js';
import type { HookErrorCode } from '../hooks/error-codes.js';
import type { TelemetryErrorCode } from '../telemetry/error-codes.js';

/**
 * Error scopes representing functional domains in the system
 * Each scope owns its validation and error logic
 */
export const ERROR_SCOPES = [
    'llm',
    'agent',
    'config',
    'context',
    'session',
    'mcp',
    'tools',
    'storage',
    'logger',
    'system_prompt',
    'resource',
    'prompt',
    'memory',
    'hook',
    'telemetry',
] as const;

export type ErrorScope = (typeof ERROR_SCOPES)[number];

/**
 * Error types that map directly to HTTP status codes
 * Each type represents the nature of the error
 */
export const ERROR_TYPES = [
    'user',
    'payment_required',
    'forbidden',
    'not_found',
    'timeout',
    'conflict',
    'rate_limit',
    'system',
    'third_party',
    'unknown',
] as const;

export type ErrorType = (typeof ERROR_TYPES)[number];

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
    | HookErrorCode
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
