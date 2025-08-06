/**
 * Union type for all error codes across domains
 * Provides type safety for error handling
 */

import type { LLMErrorCode } from '../llm/error-codes.js';
import type { AgentErrorCode } from '../agent/error-codes.js';
import type { MCPErrorCode } from '../mcp/error-codes.js';
import type { ToolErrorCode } from '../tools/error-codes.js';
import type { StorageErrorCode } from '../storage/error-codes.js';

export type DextoErrorCode =
    | LLMErrorCode
    | AgentErrorCode
    | MCPErrorCode
    | ToolErrorCode
    | StorageErrorCode;
